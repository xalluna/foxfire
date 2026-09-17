// Tags the current commit as the version package.json already names, which is
// the last step of cutting a release.
//
// Run with: node scripts/tag-release.mjs   (or `npm run tag-release`)
// Add --push to push the tag straight away, which is what starts the Release
// workflow. Without it the tag is local and the command to push it is printed.
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

const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const tag = `v${version}`

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

// The same section the Release workflow extracts for the body. Matched as an
// exact string so the version's dots are not read as wildcards.
const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
if (!changelog.includes(`## [${version}]`)) {
  fail(
    `CHANGELOG.md has no \`## [${version}]\` section, which the Release workflow needs for the body.`,
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

if (!gitWrite('tag', '-a', tag, '-m', `Foxfire ${version}`)) fail(`Could not create ${tag}.`)
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
