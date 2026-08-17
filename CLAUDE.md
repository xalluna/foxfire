# LoL Stats

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
git tag -a v0.5.0 -m "LoL Stats 0.5.0" && git push --tags
```

The workflow verifies the tag matches `package.json`, extracts that section, and publishes the
Release. Installers are not built in CI — run `npm run build:win` and attach the `.exe` by hand if a
release needs one.
