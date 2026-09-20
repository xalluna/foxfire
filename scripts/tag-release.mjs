// Tags the current commit as the version the app being released already names,
// which is the last step of cutting a release.
//
// Run with: node scripts/tag-release.mjs   (or `npm run tag-release`)
// Add --push to push the tag straight away, which is what starts the Release
// workflow. Without it the tag is local and the command to push it is printed.
//
// Two things release out of this repo, on their own tags and their own
// schedules, so the script takes which one:
//
//   npm run tag-release                    the desktop app  ->  desktop-v0.12.0
//   npm run tag-release -- --target server the server       ->  server-v0.1.0
//
// Both tags name the app they belong to. The desktop's used to be a bare
// v0.12.0, from when it was the only thing that released out of this repo — and
// a Releases page listing v0.12.0 beside server-v0.1.0 makes the reader work
// out which is which from the number. Tags cannot hold a space, so the prefix
// carries the name and the release title spells it: "Desktop v0.12.0".
//
// The nineteen tags cut under the old scheme keep their names. Renaming a tag
// moves the Release somebody may already have a link to, and the compare links
// at the bottom of the changelog point at the old ones — so the change applies
// forwards and the first entry after it spans both spellings.
//
// The default is the desktop, because that is what "a Foxfire release" meant
// for every release before there was a server and there is no reason to make
// the common case the one you have to spell out.
//
// The version is read rather than typed. Typing it means typing it twice — once
// in the PR that bumped package.json and again days later at the terminal — and
// the workflow's first act is to reject the tag if the two disagree, so the
// mistake costs a wrong tag on a real commit that then has to be deleted from
// the remote.
//
// The checks below are not ceremony. Each one is a way a release has actually
// gone wrong or could go wrong silently, and all of them are cheaper to fail
// here than after a tag is on the remote:
//
//   - A dirty tree means the tag names a commit that is not what is on disk,
//     and the installer CI builds from it will not be the thing that was tested.
//   - A tag that already exists locally or on the remote means this release was
//     already cut. Moving it would repoint a version people may already have.
//   - A missing changelog section fails the workflow's own guard after the push
//     rather than before it, leaving a tag on the remote and no Release.
//   - A commit that is not on origin/main is the one that is easy to miss. A
//     squash merge rewrites the branch commit, so the commit a PR was developed
//     on never lands on main — tagging it produces a Release pointing at a
//     commit reachable from nothing.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * What can be released, and where each one keeps its version.
 *
 * The version is read rather than typed for both, and from the file that is
 * already the source of truth for it: package.json for the desktop, because it
 * is what names the installer and what the app reports about itself, and
 * Directory.Build.props for the server, because it is what every assembly there
 * is stamped with.
 */
const TARGETS = {
  desktop: {
    dir: 'apps/desktop',
    tagPrefix: 'desktop-v',

    // What this app was tagged with before the prefix named it. Checked so
    // that re-cutting a version already released under the old spelling is
    // refused rather than quietly published twice under two names.
    legacyPrefix: 'v',
    label: 'Desktop',
    versionFile: 'package.json',
    readVersion: (raw) => JSON.parse(raw).version
  },
  server: {
    dir: 'apps/server',
    tagPrefix: 'server-v',
    label: 'Server',
    versionFile: 'Directory.Build.props',
    readVersion: (raw) => raw.match(/<VersionPrefix>([^<]+)<\/VersionPrefix>/)?.[1]
  }
}

/**
 * Trimmed stdout, or null when the command exits non-zero.
 *
 * git's own stderr is dropped because every caller below is asking a question
 * whose answer may legitimately be "no": `rev-parse --verify` on a tag that
 * does not exist prints "fatal: Needed a single revision", which is the normal
 * path through this script and reads like something went wrong.
 */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return null
  }
}

/**
 * For the two commands that write. Their failures are unexpected rather than an
 * answer, so git's diagnostic is the useful part and goes to the terminal.
 */
function gitWrite(...args) {
  try {
    execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })
    return true
  } catch {
    return false
  }
}

/** Same, but a failure is fatal — used where there is nothing sensible to do without it. */
function gitOrDie(...args) {
  const result = git(...args)
  if (result === null) fail(`git ${args.join(' ')} failed`)
  return result
}

function fail(message, hint) {
  console.error(`\n  ${message}`)
  if (hint) console.error(`  ${hint}`)
  console.error('')
  process.exit(1)
}

const push = process.argv.includes('--push')

const targetFlag = process.argv.indexOf('--target')
const targetName = targetFlag === -1 ? 'desktop' : process.argv[targetFlag + 1]
const target = TARGETS[targetName]

if (!target) {
  fail(
    `Unknown release target "${targetName ?? ''}".`,
    `Use one of: ${Object.keys(TARGETS).join(', ')}.`
  )
}

const versionPath = join(ROOT, target.dir, target.versionFile)
const version = target.readVersion(readFileSync(versionPath, 'utf8'))

if (!version) {
  fail(`Could not read a version out of ${target.dir}/${target.versionFile}.`)
}

const tag = `${target.tagPrefix}${version}`

// A tag records a tree, so the tree has to be the one being recorded.
if (gitOrDie('status', '--porcelain') !== '') {
  fail(
    `The working tree has uncommitted changes, so ${tag} would not describe what is on disk.`,
    'Commit or stash them first.'
  )
}

if (git('rev-parse', '--verify', `refs/tags/${tag}`) !== null) {
  fail(`${tag} already exists locally.`, `Delete it with \`git tag -d ${tag}\` if you meant to redo it.`)
}

// ls-remote exits 0 with empty output when the tag is absent, so this
// distinguishes "not there" from "could not reach the remote".
const remote = git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`)
if (remote === null) {
  fail('Could not reach origin to check whether the tag is already published.')
}
if (remote !== '') {
  fail(
    `${tag} is already on origin, so this release has been cut.`,
    'Bump the version and write its changelog section for a new one.'
  )
}

// The same version under the name it would have had before the prefixes. Worth
// its own check because the failure is silent otherwise: desktop-v0.12.0 does
// not exist, so every guard above passes, and the result is one version with
// two tags and two Releases.
if (target.legacyPrefix) {
  const legacy = `${target.legacyPrefix}${version}`
  const published = git('ls-remote', '--tags', 'origin', `refs/tags/${legacy}`)

  if (published === null) {
    fail('Could not reach origin to check for a tag under the old scheme.')
  }
  if (published !== '') {
    fail(
      `${version} was already released as ${legacy}, before tags named their app.`,
      'Bump the version for a new release — the old tag keeps its name.'
    )
  }
}

// The same section the Release workflow extracts for the body. Matched as an
// exact string so the version's dots are not read as wildcards.
const changelogPath = join(ROOT, target.dir, 'CHANGELOG.md')
const changelog = readFileSync(changelogPath, 'utf8')
if (!changelog.includes(`## [${version}]`)) {
  fail(
    `${target.dir}/CHANGELOG.md has no \`## [${version}]\` section, which the Release workflow needs for the body.`,
    'The section lands in the same commit as the version bump — see CLAUDE.md.'
  )
}

// Checked against the remote's idea of main, not the local branch, because the
// local one can be behind or absent entirely. A fetch first, so a main that was
// last updated days ago does not fail a commit that is genuinely on it.
if (git('fetch', 'origin', 'main', '--quiet') === null) {
  fail('Could not fetch origin/main to check the commit is on it.')
}
if (git('merge-base', '--is-ancestor', 'HEAD', 'origin/main') === null) {
  fail(
    'HEAD is not on origin/main, so this commit is not what the release should point at.',
    'If the PR was squash-merged, the commit to tag is the one on main, not the branch it came from.'
  )
}

const head = gitOrDie('rev-parse', '--short', 'HEAD')
const subject = gitOrDie('log', '-1', '--format=%s')

if (!gitWrite('tag', '-a', tag, '-m', `${target.label} v${version}`)) fail(`Could not create ${tag}.`)
console.log(`\n  Tagged ${head} as ${tag} — ${subject}`)

if (!push) {
  console.log(`\n  Nothing is on the remote yet. To publish the Release:\n`)
  console.log(`      git push origin ${tag}\n`)
  process.exit(0)
}

if (!gitWrite('push', 'origin', tag)) {
  fail(
    `The tag was created but could not be pushed.`,
    `Retry with \`git push origin ${tag}\`, or drop it with \`git tag -d ${tag}\`.`
  )
}

console.log(`  Pushed ${tag}. The Release workflow is building the installer.\n`)
