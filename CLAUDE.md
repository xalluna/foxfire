# Foxfire

## Repository layout

This is a monorepo. The Electron desktop app lives in `apps/desktop`; the Foxfire Server will live
in `apps/server`. The repo root holds only the npm workspace (`package.json` + the single
`package-lock.json` for the whole tree), this file, the README, and `.github/`.

Each app carries its own version and its own `CHANGELOG.md`, and each releases on its own tag
prefix that names it: `desktop-v*` and `server-v*`. Nothing about the two version numbers is
coupled — they move independently, and the compatibility contract between them is a separate
`apiVersion` integer that the server publishes and gates on.

A tag cannot hold a space, so the prefix carries the name and the Release title spells it out:
`desktop-v0.12.0` is published as **Desktop v0.12.0**, `server-v0.1.0` as **Server v0.1.0**.

The desktop's tags used to be a bare `v0.12.0`, from when it was the only thing that released out
of this repo. The nineteen cut that way keep their names — renaming a tag moves a Release somebody
may already have a link to, and the compare links at the bottom of the changelog point at the old
ones. So the scheme changes forwards. 0.12.0 is not out yet, which makes it the first tag under
the new name and gives it the one compare link that spans both spellings —
`compare/v0.11.0...desktop-v0.12.0`, already written that way. Every entry after it is
`desktop-v` on both sides.

## Patch notes

`apps/desktop/CHANGELOG.md` is the source of truth for what the desktop app shipped when. GitHub Releases are
generated from it by `.github/workflows/release.yml`, so the two can never disagree.

**Any PR that bumps `version` in `apps/desktop/package.json` must add that version's
`apps/desktop/CHANGELOG.md` section in the same commit.** There is no `[Unreleased]` section — the section lands with the bump that names
it.

### Format

```markdown
## [0.5.0] — 2026-08-20

One or two sentences on what this release is and why it exists.

### Added
### Changed
### Removed
### Fixed
### Under the hood
```

- Newest release first. Omit any group that has nothing in it.
- Write for someone who installed the build, not someone who reads the code. "LP now shows on each
  match row", not "attributeInterval is replayed after every sync".
- Keep the *why* from the commit body — it is usually the most useful part — and drop the
  implementation detail that carries it.
- Anything a user cannot see goes under **Under the hood**: migrations, telemetry, the rate limiter,
  test and build config. Do not delete it; it is the record.
- Add the version's compare link to the list at the bottom of the file.

### Which digit to bump

Pre-1.0, so nothing bumps major yet.

- **patch** — fixes and polish. `0.2.1` (LP chips had never rendered), `0.2.2` (single instance),
  `0.4.1` (header hairline).
- **minor** — anything a user would notice as new. `0.3.0` (curved, tier-coloured rank graph),
  `0.4.0` (hand-entered LP).

### Cutting a release

The PR already carries the version bump and the changelog section, so releasing is just:

```bash
npm run tag-release -- --push                    # the desktop app
npm run tag-release -- --target server --push    # the server
```

Both run from the repo root. The desktop is the default because that is what a
Foxfire release meant for every release before there was a server, and the common case
should not be the one you have to spell out. The desktop tags `desktop-v0.12.0` and the
server tags `server-v0.1.0`; the two patterns never collide, so each triggers only its
own workflow.

That tags the current commit as whatever version the app being released already names —
`apps/desktop/package.json` for the desktop, `<VersionPrefix>` in
`apps/server/Directory.Build.props` for the server — the version is read rather
than typed, since typing it means typing it twice and the workflow rejects a tag that disagrees with
the file. Leave off `--push` to create the tag and stop, and it prints the command to push it.

It refuses rather than tagging when the tree is dirty, when the tag already exists here or on origin,
when that app's `CHANGELOG.md` has no section for that version, or when HEAD is not on `origin/main`.
It also refuses a desktop version that was already released under the old bare-`v` name, because
every other guard would pass — `desktop-v0.12.0` does not exist — and the result would be one
version wearing two tags and two Releases. That last
one is easy to get wrong: a squash merge rewrites the branch commit, so the commit a PR was developed
on never lands on main, and tagging it gives you a Release pointing at a commit reachable from
nothing.

There is nothing to do by hand afterwards. The desktop workflow verifies the tag matches
`package.json`, extracts that section, builds the Windows installer on a Windows runner, and
publishes the Release with the installer, its `.blockmap` and `latest.yml` attached. The server
workflow does the same shape of thing on Linux: it runs the tests — including the ones that stand a
real SQL Server up in a container, so a release cannot go out on a schema that does not migrate —
then builds self-contained `linux-x64` and `win-x64` archives and a container image, pushes the
image to GHCR, and publishes the Release with both archives attached.

It builds before it publishes, and creates the Release as a draft that only becomes visible once the
uploaded installer has been read back off the API at the size that was actually built. So a release
you can see always has a download on it — a failed build, or a half-finished upload, leaves either
nothing or an invisible draft, and the next run clears the draft. It works that way because
`v0.9.0`, `v0.10.0` and `v0.10.2` all shipped with no installer on them at all, back when attaching
it was a step someone had to remember.

`npm run build:win` still builds an installer into `apps/desktop/release/`, for trying one out locally; releases
no longer need it. To exercise the CI build without cutting a release — after a dependency bump, or
a change to `electron-builder.yml` — run the workflow from the Actions tab. A dispatched run builds
the installer and hands it back as a workflow artifact, and every step that can write to a release
is gated so that it cannot.
