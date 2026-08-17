# Changelog

Patch notes for LoL Stats, newest first.

Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and the format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), with an extra **Under the hood** group for
changes you would never notice while using the app.

## [0.6.0] — 2026-08-17

The live game screen no longer empties itself when one player asks not to be named, and match rows
gained the eighth item they had been dropping — in bot lane, that item is the boots.

### Added

- Match rows and match detail show the role quest reward next to the six bought items and the
  trinket. Bot lane's reward is the player's boots, so bot rows had been showing a finished build
  with nothing on its feet. Matches already in your history get it too, with no re-sync.

### Fixed

- A live game with a withheld player renders again. Riot hides some players' identities, and a
  single hidden one used to replace the entire roster with a validation dump — nine visible players
  lost to the one that was not.
- A withheld player now shows as their champion, unnamed and without a rank, which is what was
  asked. The app had been resolving the name by another route, going around the withholding rather
  than respecting it.
- Selling an item no longer punches a hole through the middle of a build, with another item
  stranded past the trinket. The six bought slots close up to the left while the trinket and quest
  reward stay pinned to the right, so every row stays eight wide and the strips keep their columns
  down a list mixing Summoner's Rift with ARAM.

### Under the hood

- Migration 006 backfills the quest reward from the full payloads stored since 001, so history is
  recovered locally with no Riot calls. It takes its own column rather than a seventh inventory
  slot: it is granted by the lane rather than bought.
- Every field on a live game participant is now optional, so no single missing value can fail the
  parse for all ten. The cost is that this endpoint stops reporting payload drift as a parse error —
  a shape change now arrives as empty fields for the mapper to absorb.
- The participant-name lookup is gone along with the behaviour it served: its IPC channel, handler,
  preload binding, and the account endpoint that removal left orphaned.
- Live game mapping moved into its own module, so its tests need neither a database nor an API key.
- The release workflow runs `actions/checkout@v5`; v4 targets a Node version GitHub has deprecated.

## [0.5.0] — 2026-08-17

The app now tells you which version you are running, and these notes exist.

### Added

- Settings → About shows the running version, so a patch note can be matched against the build in
  front of you. There had been no way to tell from inside the app.

### Under the hood

- This file, backfilled to cover every release since the first build.
- Pushing a `v*` tag publishes a GitHub Release whose body is that version's section here, so the
  file and the release can never disagree.
- `CLAUDE.md` records the rule that keeps it current: the pull request that bumps the version writes
  the section.

## [0.4.1] — 2026-08-17

A one-line fix to the window header.

### Fixed

- The hairline under the app header stopped short of the right edge and died in mid-air beside the
  window buttons. Windows paints its own minimise/maximise/close controls over the top 40px of the
  page, and the border sat in exactly that band. It now runs the full width of the window, at both
  normal and maximised size.

## [0.4.0] — 2026-08-17

LP per game is worked out by comparing rank readings taken before and after, which only produces an
answer when exactly one ranked game sits between two readings. Play a session with the League client
closed and the whole run collapses into a single interval that cannot be split — every game in it
stays blank. You usually know the answer; there was no way to say so. Now there is.

### Added

- Right-click a match in your history and choose to edit its LP. The editor opens in its own window,
  listing your ranked games newest first.
- Type a bare LP number and it lands in the right division on its own, so most rows need nothing but
  the number.
- Stating your rank after one game is often enough to unblock its neighbours. Three unresolved games
  in a row become three single-game intervals once you fill in two of them, and the third resolves
  by itself.
- Games that cannot be edited keep the menu item, disabled with the reason — "why does this game
  have no LP?" is the question the editor exists to answer.

### Changed

- Hand-entered LP renders identically to LP the app worked out itself. This is deliberate: being
  hand-entered drives whether a live reading supersedes it and whether it can be cleared, not how it
  looks.

### Fixed

- Running from a git worktree, the dev server refused to serve the bundled fonts, so the app fell
  back to system fonts and looked broken when it was not.

### Under the hood

- An edit is stored as a rank reading rather than an attribution row, so one entry produces the LP
  chip, the promotion crest, the milestones and the graph at once — and because attribution
  recomputes the same value from it on every run, an entry needs no protection from being
  overwritten.
- Migration 005 adds a nullable `rank_snapshots.match_id`, so clearing an entry is a targeted delete
  and re-editing is an update rather than a second conflicting row at the same instant.
- The editor is a third window, hash-routed off the shared renderer bundle like the telemetry panel.

## [0.3.0] — 2026-08-16

Three changes to the rank graph, all visible on the Rank screen.

### Changed

- The line's corners are rounded instead of hard. Deliberately not a spline — a curve fitted through
  the points would overshoot between them, bulging across a tier boundary you never crossed and
  contradicting the milestone list drawn underneath. Rounding only cuts a corner, so it cannot
  invent a value you never had.
- The line takes its colour from the tier you were in at each moment, rather than painting the whole
  climb in your current tier. The switch happens exactly at the reading that first reported the new
  tier, so a segment ending in a promotion is drawn in the tier it was climbing out of.
- Dots on every point are gone. Rounding a corner cuts it, so mid-series dots detached from the line
  at spikes. The first and last points keep theirs, and the point you hover gets one at its true
  position.

### Under the hood

- The telemetry charts share the same corner rounding, except stepped counter series, which opt out
  — rounding those would draw a ramp where the counter actually jumped.
- The browser dev harness gains a second account with a generated 30-day, 301-game climb from Silver
  II to Platinum III, and its match history, rank readings, champion stats and mastery are now keyed
  per account rather than shared.

## [0.2.2] — 2026-08-16

Nothing stopped the app running twice, and two copies share everything durable they own.

### Fixed

- Launching the app while it is already running now raises the existing window instead of starting a
  second copy. Both copies had been sharing the same two databases, the same log file and the same
  saved API key — and, most damagingly, running a second Riot rate-limit queue against one key, so
  both started collecting rate-limit errors. Worst at launch, where every account syncs at once.
  This was easy to do by accident rather than hypothetical: with tray mode on, closing the window
  only hides it, so nothing on screen suggested the app was already running.
- A window created through the tray's fallback path could quit the app when closed in tray mode.

## [0.2.1] — 2026-08-16

Two reported bugs with one shared cause: nothing ever synced automatically, and LP attribution ran
too early to ever succeed.

### Fixed

- Finishing a game now pulls the match in on its own. The one automatic "a game ended" signal only
  refreshed the screen without fetching anything, and the match list reads from local storage — so
  it re-read the same rows and the finished game never appeared until you pressed Sync now.
- LP chips now actually appear. They had never rendered in a real install: attribution ran about 50
  seconds after a game ended, before Riot publishes the match, found nothing, and nothing ever
  re-triggered it. Across 108 matches it had written zero rows. It now replays after every sync, so
  whichever lands second — the match or the rank reading — the next pass closes the gap. It also
  backfills history recorded before this worked.
- A loss at 0 LP with demotion protection reads identically to the previous rank reading, so it used
  to be discarded — which left the interval open and swallowed the next game's LP figure too.

### Changed

- Automatic post-game syncs no longer flash the progress bar. A full backfill still shows one;
  hiding that would read as the app having frozen.

### Under the hood

- The end of a game is detected from the League client's game phase, firing on entry to an end phase
  so a mid-game reconnect never triggers it, then retrying on a widening schedule until the match
  appears — Riot's publish delay varies, and a single attempt would look fixed some evenings and
  broken on others.
- The attribution repair runs at launch, before the sync and independent of it. It only touches
  local data, and gating it on a Riot call meant an expired key skipped the backfill precisely when
  the key needed replacing.
- Colliding sync callers now join the running sync instead of being dropped silently, which is why
  Sync now could read as dead after a reload.
- A rejected API key is held as readable state rather than only broadcast as an event. The launch
  sync fails within ~325ms of the window opening, before anything subscribes, so the warning landed
  on nobody and a dead key became invisible.

## [0.2.0] — 2026-08-15

The app worked but looked unfinished, and it mixed every queue into one set of numbers. This release
is the visual overhaul, plus queue filtering, rank history, a richer champions table and a real
application icon.

### Added

- A Hextech-styled dark interface: real design tokens, Riot's own two golds, hand-drawn icons in
  place of literal characters, self-hosted fonts, and genuine ranked crests and position icons.
- Match rows now carry what op.gg's equivalent does — result, champion, summoner spells, runes,
  role, KDA, CS/min, kill participation, damage share, items and multi-kill badges. None of this
  needed a single new Riot API call; the data was already stored and simply never shown.
- Expanding a match surfaces gold, damage taken and role for the first time, with damage normalised
  across the whole lobby rather than per team.
- A queue filter on both match history and champion stats, defaulting to Ranked Solo/Duo. Champion
  stats could not filter at all before this, so ARAM and Normals inflated the same win rate as
  Ranked.
- A Rank page charting your climb, with per-game LP chips in match history. Rank had only ever been
  a current value that every refresh overwrote; readings are now kept.
- A richer Champions page that opens on games played rather than mastery, with bars showing the
  stats behind each row.
- A recent-form summary above the match list, worked out from the rows already on screen so it can
  never disagree with them.
- An application icon. Packaged builds had been shipping with the generic Electron logo — the
  executable, the installer, the desktop shortcut and Add/Remove Programs all fell back to it.
- A native-feeling title bar that keeps Windows' own caption buttons and snap layouts.

### Changed

- Below 1280px the identity rail folds into a horizontal strip. The two columns cannot both fit
  before match rows start clipping their item slots.
- Designed loading, empty and error states throughout. A personal Riot key expires every 24 hours,
  so these are routine rather than exceptional.
- The Riot disclaimer moved from a footer on every screen to Settings.

### Fixed

- Remakes are excluded from win rates, recent form and LP attribution. They award no LP and say
  nothing about a champion, and counting them was why these numbers disagreed with op.gg by exactly
  three games.
- Match history paged from offset 0 while growing its limit, the Champions refresh button could
  never pull fresh mastery, and a sync did not invalidate champion stats despite having just
  recomputed them from the matches it imported.

### Under the hood

- Developer telemetry: Riot API request timing, rate-limit headroom, per-process CPU and memory,
  League client status, logs and spans — in its own window, its own database, off by default and
  toggled from Settings. The app previously had no observability at all: two `console.error` calls,
  no timing anywhere, no log file and no crash handler.
- Rotating logs in the user data folder, process crash handlers and an error boundary. Warnings and
  errors are written whatever the telemetry setting says, so a crash still leaves a trace with
  collection off.
- Riot response validation moved inside the instrumented request, so a changed payload is recorded
  against the request that carried it instead of logging a clean success and failing elsewhere.
  Concrete request paths embed account identifiers, so they are only ever stored hashed.
- Migrations 002 and 004 backfill largest multi-kill and the remake flag from payloads already
  stored, so neither needs a re-sync.
- `npm run dev:web` runs every screen and state in a browser against fixture data, with no Riot key
  and no synced database.
- No invented metrics: deliberately no OP-Score substitute, no MVP or ACE, no placement. Multi-kill
  is measured, so it stayed.

## [0.1.0] — 2026-08-14

The first build. An ad-free desktop alternative to op.gg for tracking your own accounts, with every
figure coming from Riot's official Developer API rather than scraped from op.gg.

### Added

- Profile, rank, match history, live game and champion mastery.
- Match history is stored locally and served from disk — Riot is only called when syncing.
- Adding an account returns after about three API calls, then backfills your match history in the
  background with progress. Each match is committed as it arrives and stored matches are skipped, so
  an interrupted backfill resumes rather than starting over.

### Under the hood

- Only the main process touches the Riot API or the database; the interface reaches them through a
  narrow typed bridge with context isolation on.
- Every Riot call passes through one app-wide rate limiter, so backfill, live-game checks and search
  share a single fair queue.
- The API key is validated against Riot before being saved, then encrypted and stored outside the
  database file.
- An expired key fails queued work immediately and prompts for a new one, rather than stalling the
  queue indefinitely. Personal keys last 24 hours.
- Storage uses Node's built-in SQLite rather than a native module, avoiding a compilation step and
  the rebuild machinery that comes with it.

[0.6.0]: https://github.com/xalluna/my-op-gg/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/xalluna/my-op-gg/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/xalluna/my-op-gg/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/xalluna/my-op-gg/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/xalluna/my-op-gg/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/xalluna/my-op-gg/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/xalluna/my-op-gg/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/xalluna/my-op-gg/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/xalluna/my-op-gg/releases/tag/v0.1.0
