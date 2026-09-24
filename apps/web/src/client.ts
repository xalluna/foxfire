import type { AssetManifest } from '@foxfire/core'
import { buildAssetManifest } from '@foxfire/core/ddragon'
import { createServerClient, type HomeAccountStore, type ServerClient } from '@foxfire/core/server'
import { WEB_IDENTITY, session, useAuth } from './session/session'

const HOME_KEY = 'foxfire:home-account'

/**
 * Which account this browser opens on.
 *
 * A preference of the browser, not of the person: the same member might open
 * their own profile at home and their duo partner's at work. Browser storage
 * can refuse — a private window, blocked site data — and then there is simply
 * no remembered home, which is also where a first visit starts.
 */
export function browserHomeStore(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeLocalStorage()): HomeAccountStore {
  return {
    get: () => {
      try {
        return storage?.getItem(HOME_KEY) ?? null
      } catch {
        return null
      }
    },
    set: (accountId) => {
      try {
        storage?.setItem(HOME_KEY, accountId)
      } catch {
        // Not remembered; the next visit opens on the first account you claimed.
      }
    }
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * Champion, item and rune art, straight from Riot's CDN — the page fetches it
 * itself, as the server's content security policy allows. Built once per page
 * load; it changes on patch day and no other time.
 */
let manifest: Promise<AssetManifest> | null = null

function dataDragonAssets(): Promise<AssetManifest> {
  manifest ??= buildAssetManifest(fetch).catch((err: unknown) => {
    manifest = null
    throw err
  })
  return manifest
}

/** The FoxfireClient the web client's screens read through: its own server, and nothing else. */
export function createWebClient(): ServerClient {
  const client = createServerClient({
    session,
    identity: WEB_IDENTITY,
    home: browserHomeStore(),
    assets: dataDragonAssets
  })

  // Whoever is signed in is part of the connection — a refresh can bring a
  // role change with it — and the push channel only exists for somebody
  // signed in. Both follow the session.
  let previous = useAuth.getState()
  useAuth.subscribe((state) => {
    if (state.upgradeRequired && !previous.upgradeRequired) client.markUpgradeRequired()

    if (state.user !== previous.user) {
      void client.refreshConnection().catch(() => undefined)

      const was = previous.user !== null
      const now = state.user !== null
      if (now && !was) void client.connect()
      if (!now && was) void client.disconnect()
    }

    previous = state
  })

  return client
}
