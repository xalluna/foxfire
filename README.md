# Foxfire

An ad-free desktop app for viewing League of Legends stats and live games — a private alternative to op.gg for your own accounts. Foxfire records your ranked games and keeps the LP ledger for every season you have played.

It runs entirely on your own machine by default. It can also read from a **Foxfire Server** that you or your community hosts, so match history, rank and LP are shared rather than kept per PC. There is no central Foxfire service — anyone can run one, and recordings, Riot replays and the League client connection always stay on your machine either way. See [apps/server](apps/server) to host one.

A server also hosts a **web client** of its own, at its own address: the people on it can read everybody's match history, LP, the rank graph and shared replays in a browser, with nothing to install, and send each other links to them.

Built with Electron, React, and TypeScript. All data comes from **Riot's official Developer API** (op.gg's Terms of Use prohibit scraping their site, and everything here is available from Riot directly).

## Features

- **Multi-account tracking** — add your main and alt accounts, switch between them in the sidebar
- **Profile & rank** — solo/duo and flex tier, LP, win/loss, win rate
- **Match history** — expandable rows showing all 10 participants with items, runes, summoner spells, CS, gold, and damage
- **Live game** — the live scoreboard of the match running on this PC: levels, items, runes, KDA, CS and vision, updated as it plays. Read from the game itself over the Live Client Data API, so it costs no Riot call and works without an API key
- **Champions** — Riot's mastery points/levels alongside win rates computed locally from your synced games
- **Ad-hoc search** — look up any summoner without saving them
- **Optional server** — join one your community hosts to share match history, rank and LP; local-only stays a first-class mode
- **In a browser** — a server's web client shows profiles, match history, a page per game, champions and the rank graph, and "Copy link" in either client hands somebody the view you are looking at

## Setup

This is a monorepo — `npm install` from the repo root installs the whole workspace and hoists into
the root `node_modules`.

```bash
npm install
```

Then run the app:

```bash
npm run dev
```

The web client runs against a Foxfire Server — Vite forwards `/api` to `FOXFIRE_SERVER`, by default
`http://localhost:8080` — or against fixtures, with no server at all:

```bash
npm run dev -w @foxfire/web
```

```bash
npm run dev:mock -w @foxfire/web
```

### Riot API key

The app needs a Riot API key, entered through **Settings** inside the app — never a config file or environment variable.

1. Get a key from [developer.riotgames.com](https://developer.riotgames.com)
2. Open the app → **Settings** → paste it → **Save**

The key is validated against Riot before being saved, then encrypted with Electron's `safeStorage` (Windows DPAPI) and written to `%APPDATA%/Foxfire/secure/riot-api-key.enc`. It never touches the repo or the database file.

**Personal development keys expire every 24 hours.** When lookups start failing, generate a fresh one and paste it again.

## How syncing works

Adding an account resolves it in ~3 API calls and returns immediately, then backfills up to 200 recent matches in the background. Riot's personal-key rate limit (20 req/s, 100 req/2min) means a full backfill takes roughly 4 minutes; the UI stays usable throughout and matches appear as they land.

Backfill is **resumable** — each match is committed as it arrives and already-stored matches are skipped, so closing the app mid-sync costs nothing. Subsequent syncs are deltas: only matches newer than the last stored one get fetched.

Note that Riot's match-v5 endpoint only exposes a rolling window of history, so a "200 game" backfill may return fewer if that's all Riot has.

## Architecture

A monorepo of three apps and the packages they share:

```
apps/
  desktop/      the Electron app
  server/       the Foxfire Server (.NET) — its API under /api, and the web client at the root
  web/          the web client — built into the server, never deployed on its own
packages/
  core/         what every client agrees on: data shapes, LP and season rules, route paths,
                the server client, the Data Dragon manifest, the stats.db importer
  ui/           the React components and pages — props in, markup out — and the theme
  screens/      the screens both clients mount: query hooks, what each server event refreshes,
                the shared routes, and the fixtures the design harnesses render
tooling/vite/   the Vite helper every app's config shares
```

The desktop and the web client draw the same screens. The desktop's reach them through IPC, the web
client's over HTTP, and neither screen can tell which — the screens read through a client and ask a
platform for what the machine can do, so a browser simply never offers "Watch recording".

Inside `apps/desktop`:

```
src/
  main/         Electron main process — the only place that touches Riot's API or SQLite
    riot/       API client, rate limiter, per-endpoint wrappers
    db/         node:sqlite connection, migrations, repositories
    services/   account, sync, live game, mastery, search, settings, Data Dragon, the server
    ipc/        channel names + handlers
    security/   encrypted API key storage
  preload/      contextBridge — exposes a typed `window.api` surface
  renderer/     the desktop's shell: routes (TanStack Router), its own screens, and the IPC
                client the shared screens read through
  shared/       types shared across processes
```

The renderer has `contextIsolation: true` and `nodeIntegration: false`; it can never reach the network or disk directly. Every Riot call passes through a single app-wide rate limiter, so backfill and search share one fair queue.

Storage uses Node 24's built-in `node:sqlite` (bundled with Electron 43) rather than `better-sqlite3` — same synchronous API with no native compilation step, which keeps builds and packaging simple.

### Hosting the web client

There is nothing to host separately: the server serves the web client from its own address, so the
address your members connect the desktop to is the one their browser opens. Behind a reverse proxy,
forward **every** path to the server — the web client's pages as well as `/api` — and the WebSocket
upgrade on `/api/hub`, plus `/hub` for Foxfire desktop 0.12.0. See
[apps/server/docker/.env.example](apps/server/docker/.env.example) for the settings.

## Scripts

Run these from the repo root. `typecheck`, `lint` and `test` run in every workspace; the rest
delegate to the one they name.

| Command | Purpose |
|---|---|
| `npm run dev` | Run the desktop in development with hot reload |
| `npm run dev:web` | The desktop's screens in a browser, on fixtures — `?scenario=` switches the state |
| `npm run build` | Type-check and bundle the desktop |
| `npm run build:win` | Produce a Windows NSIS installer in `apps/desktop/release/` |
| `npm run dev -w @foxfire/web` | Run the web client against a server |
| `npm run dev:mock -w @foxfire/web` | Run the web client on fixtures, with no server |
| `npm run build -w @foxfire/web` | Build the web client into `apps/web/dist/` |
| `npm test` | Run unit tests in every workspace |
| `npm run typecheck` | Type-check every workspace |
| `npm run lint` | Lint every workspace |
| `npm run make-mark -w @foxfire/desktop` | Regenerate the logo geometry in `packages/ui/src/assets/logoMark.json` |
| `npm run make-icon -w @foxfire/desktop` | Redraw the app icon, tray icon and favicon from that geometry |

The server has its own: `dotnet test apps/server` runs its suites, which stand SQL Server and Azurite
up in containers and so need Docker running.

## Disclaimer

Foxfire isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
