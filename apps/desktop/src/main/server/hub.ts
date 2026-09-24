import { createHub, type ClientIdentity, type ServerHub } from '@foxfire/core/server'
import { broadcast } from '../ipc/broadcast'
import { CH } from '../ipc/channels'
import { setServerRiotKeyRejected } from '../services/serverService'
import { createLogger } from '../telemetry/logger'

const log = createLogger('hub')

/**
 * The server's push channel, turned back into the events this app already has.
 *
 * In local-only mode a sync raises `sync:progress` for itself and the renderer
 * listens. Connected to a server the sync is somebody else's process and the
 * event arrives over a socket — but it is the same event, on the same channel,
 * with the same payload, so everything above the transport is unchanged. That
 * is what Phase 0's broadcast module was extracted for.
 *
 * The connection itself is @foxfire/core's, shared with the web client; what is
 * here is where each event goes on this machine, and which server to listen to.
 */
let connection: ServerHub | null = null

type SyncCompleteListener = (accountId: string) => void
const syncCompleteListeners = new Set<SyncCompleteListener>()

/**
 * Called when the server finishes syncing an account.
 *
 * The moment a game this machine recorded can first be found on the server,
 * so it is when a recording waiting for its game should look again — which
 * until now only happened at the next launch. Wired from index.ts rather than
 * imported here, so the hub does not reach into the recording service.
 */
export function onServerSyncComplete(listener: SyncCompleteListener): () => void {
  syncCompleteListeners.add(listener)
  return () => syncCompleteListeners.delete(listener)
}

/** The server this connection belongs to, so a switch can be told from a reconnect. */
let connectedTo: string | null = null

/**
 * Opens the connection, replacing any that was open to a different server.
 *
 * Idempotent for the server already connected to, because the callers are
 * events rather than a lifecycle: signing in, switching servers, and a token
 * renewal all arrive here, and only the first of those should cost a handshake.
 */
export async function connectHub(
  serverUrl: string,
  basePath: string,
  identity: ClientIdentity,
  accessTokenFactory: () => string | Promise<string>
): Promise<void> {
  if (connectedTo === serverUrl && connection?.connected) return

  await disconnectHub()

  const hub = createHub({
    baseUrl: serverUrl,
    basePath,
    identity,
    accessTokenFactory,
    log,
    handlers: {
      onSyncProgress: (event) => {
        broadcast(CH.sync.progress, event)
        if (event.phase === 'complete') {
          for (const listener of syncCompleteListeners) listener(event.accountId)
        }
      },
      onRecordingChanged: (event) => broadcast(CH.matchRecordings.changed, event),
      onRankEdited: (accountId) => broadcast(CH.rank.edited, accountId),
      onRankChanged: (accountId) => broadcast(CH.lcu.rankChanged, accountId),

      // Deliberately not the channel local-only mode uses for an expired key.
      // That one means "yours expired, paste a new one" and is wired to a
      // banner that offers to take you to the field; this means the host's did,
      // and there is nothing on this machine to paste. Same situation, different
      // person to tell — so it goes into the server state and gets its own
      // sentence.
      onKeyInvalid: () => setServerRiotKeyRejected(true)
    }
  })

  await hub.start()

  // Kept even when it did not open, so the next announcement tries again: an
  // unopened connection reports itself as not connected, which is exactly the
  // condition the guard above retries on.
  connection = hub
  connectedTo = serverUrl
}

/** Closes the connection, if there is one. Safe to call when there is not. */
export async function disconnectHub(): Promise<void> {
  const open = connection
  connection = null
  connectedTo = null

  if (open) await open.stop()
}

/** Whether the desktop currently has a live connection to its server. */
export function isHubConnected(): boolean {
  return connection?.connected ?? false
}
