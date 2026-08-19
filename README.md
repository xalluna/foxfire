# Foxfire

A personal, ad-free desktop app for viewing League of Legends stats and live games — a private alternative to op.gg for your own accounts. Foxfire records your ranked games, keeps the LP ledger for every season you have played, and never asks anyone else about them.

Built with Electron, React, and TypeScript. All data comes from **Riot's official Developer API** (op.gg's Terms of Use prohibit scraping their site, and everything here is available from Riot directly).

## Features

- **Multi-account tracking** — add your main and alt accounts, switch between them in the sidebar
- **Profile & rank** — solo/duo and flex tier, LP, win/loss, win rate
- **Match history** — expandable rows showing all 10 participants with items, runes, summoner spells, CS, gold, and damage
- **Live game** — manual check for the current match with progressively-loading ranks for all 10 players
- **Champions** — Riot's mastery points/levels alongside win rates computed locally from your synced games
- **Ad-hoc search** — look up any summoner without saving them

## Setup

```bash
npm install
```

Then run the app:

```bash
npm run dev
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

```
src/
  main/         Electron main process — the only place that touches Riot's API or SQLite
    riot/       API client, rate limiter, per-endpoint wrappers
    db/         node:sqlite connection, migrations, repositories
    services/   account, sync, live game, mastery, search, settings, Data Dragon
    ipc/        channel names + handlers
    security/   encrypted API key storage
  preload/      contextBridge — exposes a typed `window.api` surface
  renderer/     React UI (TanStack Query for data, Zustand for UI state)
  shared/       types shared across processes
```

The renderer has `contextIsolation: true` and `nodeIntegration: false`; it can never reach the network or disk directly. Every Riot call passes through a single app-wide rate limiter, so backfill, live-game checks, and search share one fair queue.

Storage uses Node 24's built-in `node:sqlite` (bundled with Electron 43) rather than `better-sqlite3` — same synchronous API with no native compilation step, which keeps builds and packaging simple.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Run in development with hot reload |
| `npm run build` | Type-check and bundle |
| `npm run build:win` | Produce a Windows NSIS installer in `release/` |
| `npm test` | Run unit tests |
| `npm run typecheck` | Type-check both processes |
| `npm run lint` | Lint |
| `npm run make-mark` | Regenerate the logo geometry in `src/shared/logoMark.json` |
| `npm run make-icon` | Redraw the app icon, tray icon and favicon from that geometry |

## Disclaimer

Foxfire isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing League of Legends. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc.
