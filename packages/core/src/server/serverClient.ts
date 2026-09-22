import type { ConnectionState, FoxfireClient, Unsubscribe } from '../client'
import type { AssetManifest, SyncProgressEvent, VersionInfo } from '../types'
import { silentLogger, type Logger } from '../log'
import { createServerApi, type ServerApi } from './api'
import { createServerData } from './data'
import type { HomeAccountStore } from './home'
import { createHub, type ServerHub } from './hub'
import type { ClientIdentity } from './identity'
import { getVersionInfo } from './probe'
import type { ServerSession } from './session'

export interface ServerClientOptions {
  session: ServerSession
  identity: ClientIdentity
  /** Which account opens first, remembered wherever this client keeps preferences. */
  home: HomeAccountStore
  /**
   * Whether an account list with no home and nothing of your own opens on the
   * first account anyway. The desktop does; a browser would rather show its
   * list of players than a stranger's profile. See applyHomeAccount.
   */
  fallbackToAnyAccount: boolean
  /** Champion, item and rune art — Data Dragon, fetched by whoever runs this. */
  assets: () => Promise<AssetManifest>
  log?: Logger
}

/** A FoxfireClient over one server, and the few handles its owner needs to drive it. */
export interface ServerClient extends FoxfireClient {
  /** Every route, typed, for what the shared contract does not cover — importing a stats.db. */
  readonly api: ServerApi
  /** Opens the push channel. Once signed in. */
  connect(): Promise<void>
  /** Closes it. On signing out. */
  disconnect(): Promise<void>
  /** Reads the connection again and tells everybody listening — after signing in or out. */
  refreshConnection(): Promise<ConnectionState>
  /** The server refused this client's API version: every screen should say to reload. */
  markUpgradeRequired(): void
}

interface Health {
  status: string
  riotKeyRejected: boolean
}

/**
 * A FoxfireClient answered entirely by one Foxfire Server, as the web client
 * uses it.
 *
 * The session keeps somebody signed in; this is everything around it — the
 * data routes, a server's admin surface, the push channel turned into the
 * events the screens subscribe to, and the connection, read from the server's
 * own handshake and health check. Nothing here decides anything the server
 * decides: who may write, who is an admin, what a page shows.
 */
export function createServerClient(options: ServerClientOptions): ServerClient {
  const { session } = options
  const log = options.log ?? silentLogger

  const api = createServerApi(session.request, { log })
  const data = createServerData(api, options.home, { fallbackToAny: options.fallbackToAnyAccount })

  const syncListeners = new Set<(event: SyncProgressEvent) => void>()
  const editedListeners = new Set<(accountId: string) => void>()
  const changedListeners = new Set<(accountId: string) => void>()
  const connectionListeners = new Set<(state: ConnectionState) => void>()

  let version: VersionInfo | null = null
  let riotKeyRejected = false
  let upgradeRequired = false

  function subscribe<T>(set: Set<T>, listener: T): Unsubscribe {
    set.add(listener)
    return () => set.delete(listener)
  }

  function describe(): ConnectionState {
    const user = session.user()
    return {
      mode: 'server',
      publicUrl: version?.publicUrl ?? null,
      serverName: version?.serverName ?? null,
      session: user ? { username: user.username, email: user.email, isAdmin: user.isAdmin } : null,
      riotKeyRejected,
      upgradeRequired: upgradeRequired ? 'reload' : null
    }
  }

  function announce(): ConnectionState {
    const state = describe()
    for (const listener of connectionListeners) listener(state)
    return state
  }

  async function readConnection(): Promise<ConnectionState> {
    // The handshake says who the server is and where its web client lives,
    // and changes only when the server is upgraded, so it is read once. Health
    // is read every time: the key is refused at three in the morning, not on
    // a schedule.
    version ??= await getVersionInfo(session.transport)

    try {
      const health = await session.transport.request<Health>('/health')
      riotKeyRejected = health.riotKeyRejected
    } catch (err) {
      log.debug('Could not read the server health', { error: String(err) })
    }

    return describe()
  }

  // Built on first connect rather than here: there is nothing to connect until
  // somebody signs in, and a page that never does should not hold a socket
  // object for a server it has no session with.
  let hub: ServerHub | null = null

  function openHub(): ServerHub {
    hub ??= createHub({
      baseUrl: session.baseUrl,
      basePath: session.basePath,
      identity: options.identity,
      accessTokenFactory: () => session.accessToken(),
      log,
      handlers: {
        onSyncProgress: (event) => syncListeners.forEach((listener) => listener(event)),
        onRankEdited: (accountId) => editedListeners.forEach((listener) => listener(accountId)),
        onRankChanged: (accountId) => changedListeners.forEach((listener) => listener(accountId)),
        onKeyInvalid: () => {
          riotKeyRejected = true
          announce()
        }
      }
    })
    return hub
  }

  return {
    ...data,
    api,

    connection: {
      get: readConnection,
      onChanged: (listener) => subscribe(connectionListeners, listener)
    },

    assets: { get: options.assets },

    admin: {
      users: api.admin.users,
      updateUser: api.admin.updateUser,
      deleteUser: api.admin.deleteUser,
      invites: api.admin.invites,
      createInvite: api.admin.createInvite,
      revokeInvite: api.admin.revokeInvite,
      getSettings: api.admin.getSettings,
      setSettings: api.admin.setSettings,
      storage: api.admin.storage,
      storedReplays: api.admin.storedReplays,
      removeReplay: api.admin.removeReplay,
      forceUnlink: api.admin.forceUnlink
    },

    events: {
      onSyncProgress: (listener) => subscribe(syncListeners, listener),
      onRankEdited: (listener) => subscribe(editedListeners, listener),
      onRankChanged: (listener) => subscribe(changedListeners, listener)
    },

    connect: () => openHub().start(),
    disconnect: async () => {
      await hub?.stop()
    },

    async refreshConnection() {
      await readConnection()
      return announce()
    },

    markUpgradeRequired() {
      if (upgradeRequired) return
      upgradeRequired = true
      announce()
    }
  }
}
