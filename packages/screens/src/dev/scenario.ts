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
