# Foxfire

## Repository layout

This is a monorepo. The repo root holds only the npm workspace (`package.json` + the single
`package-lock.json` for the whole tree), `tsconfig.base.json` and `.eslintrc.json` for every
package, this file, the README, and `.github/`.

- `apps/desktop` — the Electron app: main process, preload, the IPC client, and the desktop's
  own screens (live game, captures, the recording player, telemetry, archives, the settings that
  are about this PC).
- `apps/server` — the Foxfire Server (.NET). Its API is under `/api`, and it hosts the web client
  at the root of the same address.
- `apps/web` — the web client. Built into the server's image and archives and served by the server
  it talks to; it has no deployable, version or changelog of its own.
- `packages/core` — what every client agrees on: the data shapes, the LP and season rules, route
  paths, the server client, the Data Dragon manifest and the stats.db importer. No React, no Node,
  no DOM beyond what a browser and Node share — ESLint enforces it.
- `packages/ui` — the React components and pages, presentational only: props in, markup out. The
  Tailwind preset, tokens, fonts, crests and logo live here.
- `packages/screens` — the screens both clients mount: react-query hooks and keys, what each server
  event refreshes, the Client/Platform providers, the shared routes, and the dev fixture client.
- `tooling/vite` — the Vite `fs.allow` helper every app's config shares.

Dependencies run `core ← ui ← screens ← {desktop renderer, web}` and `core ← desktop main`, and
nothing depends on an app. The packages are TypeScript source with no build of their own: `exports`
points at `.ts`, and each app's Vite compiles them. In the desktop they are devDependencies, which is
what makes electron-vite bundle them rather than leave a runtime `require` of a `.ts` file.

Each app carries its own version and its own `CHANGELOG.md`, and each releases on its own tag
prefix that names it: `desktop-v*` and `server-v*`. Nothing about the two version numbers is
coupled — they move independently. Compatibility is the server's to judge, two ways:

- **A desktop by its exact version**, against `DesktopCompatibility.Allowed` in
  `apps/server/src/Foxfire.Core`. A build that is not on the list is refused with 426. So **a PR
  that bumps the desktop's version adds that version to `Allowed` in the same change**, and a server
  release is what ships it. From 0.14.0 that list decides more than who is served: a desktop
  connected to a server updates itself to the newest version on *that server's* list — the
  `recommendedDesktop` it publishes in `/version` — so a host updating their server is what moves
  everybody on it, and an update can never carry somebody past what their own community accepts.
- **The web client by the API version its page was built against** — `WEB_API_VERSION` in
  `packages/core/src/server/identity.ts`, admitted when it is in `DesktopCompatibility.WebApiVersions`.
  A test on the server side reads the TypeScript constant and fails if the two disagree. A tab left
  open across an upgrade to an API it no longer matches is told to reload.

`DesktopCompatibility.ApiVersion` is the contract version the server publishes in `/version`; it
bumps only when something breaks compatibility.

A tag cannot hold a space, so the prefix carries the name and the Release title spells it out:
`desktop-v0.12.0` is published as **Desktop v0.12.0**, `server-v0.1.0` as **Server v0.1.0**.

The desktop's tags used to be a bare `v0.12.0`, from when it was the only thing that released out
of this repo. The nineteen cut that way keep their names — renaming a tag moves a Release somebody
may already have a link to, and the compare links at the bottom of the changelog point at the old
ones. So the scheme changed forwards. 0.12.0 was the first tag under the new name, and has the one
compare link that spans both spellings — `compare/v0.11.0...desktop-v0.12.0`. Every entry after it
is `desktop-v` on both sides.

## The server's front door

The API lives under `/api`, and everything else at the root is the web client's — its pages and the
files they load. The split is what lets one address answer both a desktop asking for `/api/search`
and a browser opening `/search`. `/version` and `/health` answer at the root as well as under
`/api`, permanently: they are how a client finds the API, and a health check should not have to
change because the API moved.

Desktop 0.12.0 predates `/api` and calls everything at the root. `Versioning/LegacyRootShim.cs`
keeps it working: a request carrying `X-Foxfire-Client` (every desktop sends it, no browser opening
a page does) that is not already under `/api` is moved there before routing. **Delete the shim in
the same PR that takes 0.12.0 off `Allowed`** — from then on every desktop the server serves calls
`/api` itself.

A server that has not been updated refuses a desktop newer than anything it knows, and names the
newest it does know — an older one. The desktop reads that as the server being behind rather than
as a version to install; see `judge` in `packages/core/src/server/probe.ts`.

## How the desktop updates itself

From 0.14.0 the desktop keeps itself current, out of this repository's own Releases. The feed is one
release's assets — `releases/download/desktop-v<version>/` — read by electron-updater's generic
provider, which is also what keeps delta downloads working: it finds the installed build's blockmap
by swapping the version inside that URL, and the version appears in both the tag and the file name.

`apps/desktop/src/main/updater` holds it, and `target.ts` holds the rule worth knowing:

- **Connected to a server** — install that server's `recommendedDesktop`, never what is newest. A
  build past the server's allow list would be refused by it, so an update would lock somebody out
  of their own community.
- **Local-only** — install the newest desktop release, found from `releases/latest` (which answers
  JSON with the tag on it, and costs none of `api.github.com`'s hourly budget).
- **Server unreachable** — do nothing. Falling back to the newest release the moment a host's
  machine is down installs the one build that server might refuse when it comes back.

Nothing installs while the app is open except on request: the download is quiet, the offer sits in
the window and the tray, and it is refused while a game is on or a recording is running. Otherwise
it installs on the next quit. The Releases page stays the way in for a first install, which is why
the repository is public.

## How recordings reach YouTube

A recording starts as an OBS file on one PC. From 0.14.0 it can go to YouTube, and from there be
watched by everybody on a server — on the desktop and in the browser. The rule everything follows:
**a recording is one player's view of one game**. A server keys it on (match, Riot account), never on
the match alone, so in a game two members recorded each history plays its own and no other history
offers either. That rule lives in the row query in `MatchReads.MatchListAsync`, which is where to
look if a recording ever turns up on the wrong history.

The path, in `apps/desktop/src/main/youtube`:

- **Connect** once per install, in Settings › YouTube: Google's installed-app flow (system browser,
  a one-request server on 127.0.0.1, PKCE), scopes `youtube.upload` and `openid email` only. The
  refresh token is a secret in `keyStore`; nothing that crosses IPC carries it.
- **Upload** through a queue in SQLite (`youtube_uploads`), one at a time, using YouTube's resumable
  protocol so an upload survives a restart. It holds from champ select until the game is over, and
  while OBS is recording; it waits out the quota until midnight Pacific. The uploader chooses title,
  description and privacy every time — YouTube requires it — prefilled from the templates in
  `@foxfire/core/youtube`.
- **Attach** on the server, owner only, with the markers from this PC's database: whenever an
  upload finishes, a recording finds its game, a server sync completes, or the active server
  changes. `recording_attachments` remembers what each server was told, so a recording somebody took
  off the server stays off.

The player is shared (`packages/ui/src/recording`) and takes a mount function for YouTube, because
the two clients reach YouTube's frame differently. The web loads the IFrame API into its page — the
CSP in `SpaHosting.cs` allows exactly that script and the `youtube-nocookie.com` frame — and makes
the frame itself so it can carry `referrerpolicy`, since YouTube refuses to play for a page that
sends no Referer. The desktop never loads Google's script into a window that has the preload's
bridge: the player lives on `foxfire-youtube://player`, a page with no preload, framed by the
recording window and driven over postMessage, and main puts `https://com.brandonbarr.foxfire/` on
its requests as the Referer. Nothing may be drawn over YouTube's player; the markers sit beneath it.

Electron accepts `registerSchemesAsPrivileged` once. Every scheme of ours is in the single call in
`main/schemes.ts` — registering a new one anywhere else silently unregisters the others.

The Google client is baked in at build time from `MAIN_VITE_YOUTUBE_CLIENT_ID` and, optionally,
`MAIN_VITE_YOUTUBE_CLIENT_SECRET` (repository secrets in the release workflow; `.env.local` for
development). Neither is a security boundary — anything in an installer can be read back out, and
Google treats installed apps as unable to keep a secret — so the secret is sent only when a build has
one, and a build without a client id has no uploads and says so. What protects a channel is the
user's own refresh token, PKCE, and the loopback-only redirect. The quota is the Google project's,
shared by every install; until YouTube's audit passes, every upload is forced private.
`apps/desktop/docs/YOUTUBE_SETUP.md` covers the project, the reviews and the secrets, and
`apps/desktop/docs/PRIVACY.md` is the policy Google needs a URL for.

## Patch notes

`apps/desktop/CHANGELOG.md` is the source of truth for what the desktop app shipped when. GitHub Releases are
generated from it by `.github/workflows/release.yml`, so the two can never disagree.
`apps/server/CHANGELOG.md` is the same for the server, through `.github/workflows/release-server.yml`
— and it is also where the web client's changes go, because the web client ships inside the server
and has no release of its own. A change in `packages/` is recorded in the changelog of each app that
ships it: a fix to a shared screen is a line in both.

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
node scripts/tag-release.mjs --push           # the desktop app
node scripts/tag-release.mjs server --push    # the server
```

Both run from the repo root, and both go straight to node rather than through
`npm run`. That is not fussiness. PowerShell eats `--` as its own end-of-parameters
token, so `npm run tag-release -- --target server` reaches npm as
`npm run tag-release --target server`; npm then claims `--target` and `--push` as its
own config, warns about them, and passes neither on. What the script used to receive was
a bare `server` and no flags — so it fell back to the desktop and tagged the wrong app
without saying so. It refuses to guess now, and the target is a bare word because that is
the one form nothing along the way takes an interest in.

The desktop is the default because that is what a Foxfire release meant for every
release before there was a server, and the common case should not be the one you have to
spell out. The desktop tags `desktop-v0.12.0` and the
server tags `server-v0.1.0`; the two patterns never collide, so each triggers only its
own workflow.

When one PR bumps both apps, tag the server first. A desktop bump puts its version on the server's
allow list, so the desktop that PR ships is refused by every server release before it — 0.13.0 also
calls `/api`, which only Server 0.2.0 has — and its Release should not be the first to go out. That
ordering decides when the update reaches anybody, too: a desktop connected to a server installs the
version *that server* names, so the desktop Release can sit there for a week and nobody moves until
the server release carrying the new allow list is deployed. Local-only copies take it immediately.

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
`package.json`, extracts that section, builds the Windows installer on a Windows runner — with the
section built into `latest.yml`, which is how the patch notes reach the app — and publishes the
Release with the installer, its `.blockmap` and `latest.yml` attached, marked as the repository's
**Latest** release. The server
workflow does the same shape of thing on Linux: it runs the tests — including the ones that stand a
real SQL Server up in a container, so a release cannot go out on a schema that does not migrate —
then builds the web client, self-contained `linux-x64` and `win-x64` archives that carry it, and a
container image that builds its own, pushes the image to GHCR, and publishes the Release with both
archives attached — explicitly **not** as Latest. Both apps release into one list, and that badge
belongs to the desktop installer: it is where a browser lands from the Releases page, and where the
updater reads the newest desktop version from.

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

## Checks

From the repo root, `npm run typecheck`, `npm run lint` and `npm test` each run in every workspace
that has the script. The server is `dotnet test apps/server`, and its API suite stands SQL Server
and Azurite up in containers, so it needs Docker running.

Every pull request, and every push to `main`, runs `.github/workflows/ci.yml`:

- **Node, on Windows** — `npm ci`, then typecheck, lint and test across every workspace, then build
  the web client and the desktop. Windows because the desktop's tests assert Windows paths, and
  without skipping Electron's download, because the modules that import it need its binary.
- **Server, on Linux** — `dotnet test`, including the container suites, which is the only place a
  schema that does not migrate is caught before a release is.
- **Image, on Linux** — the server's container image, web client included, built and thrown away,
  so a Dockerfile that no longer builds is found before a tag is pushed rather than after.

Tests go at the seams as plain node-environment vitest — the rules, the search params, what each
event refreshes, what a menu offers on each platform — with no DOM test setup. The screens
themselves are checked by eye in the fixture harnesses: `npm run dev:web` for the desktop's
renderer and `npm run dev:mock -w @foxfire/web` for the web client, both switched by `?scenario=`.
