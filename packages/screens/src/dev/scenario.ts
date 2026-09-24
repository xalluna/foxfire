/**
 * Scenario switch, read from ?scenario= in the URL.
 *
 * The states below are not rare edge cases in this app: a personal Riot key
 * expires every 24 hours, so no-key and key-expired are part of ordinary use
 * and need to be as designed as the happy path. Some are the desktop's alone
 * (no-key, key-expired, not-live, no-obs); the fixture client answers the rest,
 * and the desktop's mock builds on it for its own.
 */
export type Scenario =
  | 'default'
  | 'loading'
  | 'no-key'
  | 'key-expired'
  | 'no-accounts'
  | 'no-matches'
  | 'sync-error'
  | 'not-live'
  | 'no-obs'
  // Signed in to a Foxfire server; refused by one for being too old; and one
  // whose own Riot key has expired, which is the state a personal key reaches
  // every twenty-four hours and which nobody on this machine can fix.
  | 'server-connected'
  | 'server-outdated'
  | 'server-degraded'
  // Signed in to a server older than this build, which refuses it — the case
  // where the remedy is the host's, not anybody's download.
  | 'server-behind'
  // The desktop's updater, which has four states worth looking at: one waiting
  // to be installed, one that cannot be installed yet because a game is on, one
  // still downloading, and one held back by what the active server accepts.
  // The fifth is the note the build shows once, after an update has landed.
  | 'update-ready'
  | 'update-blocked'
  | 'update-downloading'
  | 'update-held'
  | 'just-installed'
  // Recordings on YouTube. The queue in every state it can be in; a build with
  // no Google client in it; one with a client and nobody connected; and a
  // recording that plays for nobody but its owner.
  | 'youtube-queue'
  // A season of games recorded and none of them on YouTube yet, for the
  // batch upload: select all, one privacy, queue the lot.
  | 'youtube-backlog'
  | 'youtube-unconfigured'
  | 'youtube-disconnected'
  | 'recording-private'

function currentScenario(): Scenario {
  const raw = new URLSearchParams(window.location.search).get('scenario')
  return (raw ?? 'default') as Scenario
}

export const scenario: Scenario = currentScenario()

/** Never resolves — holds the UI in its loading state for inspection. */
const NEVER = new Promise<never>(() => {})

/**
 * A believable network delay.
 *
 * `hold: false` opts a call out of the `loading` scenario. The shell needs its
 * accounts, settings and asset manifest to resolve before any screen renders at
 * all, so stalling those would only ever show the "no accounts" state. Holding
 * just the data queries reproduces the state that actually matters: a populated
 * app waiting on its match list.
 */
export function delay<T>(value: T, ms = 180, hold = true): Promise<T> {
  if (scenario === 'loading' && hold) return NEVER
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

export function fail(message: string): Promise<never> {
  if (scenario === 'loading') return NEVER
  return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), 180))
}

export const KEY_EXPIRED = 'Riot API returned 401 — your key has expired.'

/** The server the harness pretends to be connected to. */
export const MOCK_SERVER_URL = 'https://foxfire.example.com'
