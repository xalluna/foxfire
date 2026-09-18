import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { HubConnection } from '@microsoft/signalr'
import { app } from 'electron'
import { broadcast } from '../ipc/broadcast'
import { CH } from '../ipc/channels'
import { CLIENT_VERSION_HEADER } from './client'
import { createLogger } from '../telemetry/logger'
import type { SyncProgressEvent } from '@shared/types'

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
 * Nothing is subscribed to. Every member of a server sees every account's data,
 * so there are no groups to join and nothing to filter: an event carries the
 * account it is about, which is what the renderer already keys on.
 */
let connection: HubConnection | null = null

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
  accessTokenFactory: () => string | Promise<string>
): Promise<void> {
  if (connectedTo === serverUrl && connection?.state === HubConnectionState.Connected) return

  await disconnectHub()

  const hub = new HubConnectionBuilder()
    .withUrl(`${serverUrl}/hub`, {
      // The token goes in the query string, which is the one place a WebSocket
      // handshake can carry it — the server reads it there for this path only.
      accessTokenFactory,

      // The negotiate request is an ordinary HTTP call and passes the version
      // gate like every other, so a build the server will not serve is refused
      // here too rather than getting a live connection it cannot use.
      headers: { [CLIENT_VERSION_HEADER]: app.getVersion() }
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()

  hub.on('sync:progress', (event: SyncProgressEvent) => broadcast(CH.sync.progress, event))
  hub.on('rank:edited', (accountId: string) => broadcast(CH.rank.edited, accountId))
  hub.on('lcu:rankChanged', (accountId: string) => broadcast(CH.lcu.rankChanged, accountId))

  // The same channel local-only mode uses for an expired key, and deliberately:
  // there it means "yours expired, paste a new one" and here it means "the
  // host's did". The banner text differs; that reads still work and writes have
  // stopped does not.
  hub.on('settings:keyInvalid', () => broadcast(CH.settings.keyInvalid))

  hub.onreconnected(() => log.info('Reconnected to the server'))
  hub.onclose((err) => {
    if (err) log.debug('Hub connection closed', { error: String(err) })
  })

  try {
    await hub.start()
    connection = hub
    connectedTo = serverUrl
    log.info('Listening to the server for updates')
  } catch (err) {
    // Never fatal. Everything the hub carries is a refresh of something the
    // renderer can also ask for, so a server whose socket will not open is a
    // server that works with a stale screen rather than one that does not work.
    log.debug('Could not open the hub connection', { error: String(err) })
  }
}

/** Closes the connection, if there is one. Safe to call when there is not. */
export async function disconnectHub(): Promise<void> {
  const open = connection
  connection = null
  connectedTo = null

  if (!open) return

  try {
    await open.stop()
  } catch {
    // Stopping a connection that was already broken is not worth reporting.
  }
}

/** Whether the desktop currently has a live connection to its server. */
export function isHubConnected(): boolean {
  return connection?.state === HubConnectionState.Connected
}
