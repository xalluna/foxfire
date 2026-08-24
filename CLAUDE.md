# Foxfire

## Patch notes

`CHANGELOG.md` at the repo root is the source of truth for what shipped when. GitHub Releases are
generated from it by `.github/workflows/release.yml`, so the two can never disagree.

**Any PR that bumps `version` in `package.json` must add that version's `CHANGELOG.md` section in
the same commit.** There is no `[Unreleased]` section — the section lands with the bump that names
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
git tag -a v0.5.0 -m "Foxfire 0.5.0" && git push --tags
```

There is nothing to do by hand afterwards. The workflow verifies the tag matches `package.json`,
extracts that section, builds the Windows installer on a Windows runner, and publishes the Release
with the installer, its `.blockmap` and `latest.yml` attached.

It builds before it publishes, and creates the Release as a draft that only becomes visible once the
uploaded installer has been read back off the API at the size that was actually built. So a release
you can see always has a download on it — a failed build, or a half-finished upload, leaves either
nothing or an invisible draft, and the next run clears the draft. It works that way because
`v0.9.0`, `v0.10.0` and `v0.10.2` all shipped with no installer on them at all, back when attaching
it was a step someone had to remember.

`npm run build:win` still builds an installer into `release/`, for trying one out locally; releases
no longer need it. To exercise the CI build without cutting a release — after a dependency bump, or
a change to `electron-builder.yml` — run the workflow from the Actions tab. A dispatched run builds
the installer and hands it back as a workflow artifact, and every step that can write to a release
is gated so that it cannot.
