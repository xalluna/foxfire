import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr'
import type { SyncProgressEvent } from '../types'
import { silentLogger, type Logger } from '../log'
import { identityHeaders, identityQuery, type ClientIdentity } from './identity'

/** What the server pushes, each as the event the screens already know. */
export interface HubHandlers {
  onSyncProgress?(event: SyncProgressEvent): void
  /** Somebody hand-entered LP on this account. */
  onRankEdited?(accountId: string): void
  /** A League client reported a rank that moved. */
  onRankChanged?(accountId: string): void
  /** Riot has refused the server's own key. */
  onKeyInvalid?(): void
}

export interface HubOptions {
  /** The server's origin, or '' for the page's own. */
  baseUrl: string
  basePath?: string
  identity: ClientIdentity
  /** Called for every connection attempt, so a renewed token is picked up on reconnect. */
  accessTokenFactory: () => string | Promise<string>
  handlers: HubHandlers
  log?: Logger
}

/** One live connection to one server's push channel. */
export interface ServerHub {
  start(): Promise<void>
  stop(): Promise<void>
  readonly connected: boolean
}

/**
 * The server's push channel.
 *
 * Nothing is subscribed to. Every member of a server sees every account's data,
 * so there are no groups to join and nothing to filter: an event carries the
 * account it is about, which is what the screens already key on.
 *
 * Never fatal. Everything the hub carries is a refresh of something a screen
 * can also ask for, so a server whose socket will not open is a server that
 * works with a stale screen rather than one that does not work — `start` logs
 * and returns rather than throwing.
 */
export function createHub(options: HubOptions): ServerHub {
  const log = options.log ?? silentLogger
  const query = new URLSearchParams(identityQuery(options.identity)).toString()
  const url = `${options.baseUrl}${options.basePath ?? ''}/hub${query ? `?${query}` : ''}`

  const connection = new HubConnectionBuilder()
    .withUrl(url, {
      // The token goes in the query string, which is the one place a WebSocket
      // handshake can carry it — the server reads it there for this path only.
      accessTokenFactory: options.accessTokenFactory,

      // The negotiate request is an ordinary HTTP call and passes the version
      // gate like every other, so a build the server will not serve is refused
      // here too rather than getting a live connection it cannot use. A browser
      // drops these from the socket itself, which is what the query is for.
      headers: identityHeaders(options.identity)
    })
    .withAutomaticReconnect()
    .configureLogging(LogLevel.Warning)
    .build()

  const { handlers } = options
  connection.on('sync:progress', (event: SyncProgressEvent) => handlers.onSyncProgress?.(event))
  connection.on('rank:edited', (accountId: string) => handlers.onRankEdited?.(accountId))
  connection.on('lcu:rankChanged', (accountId: string) => handlers.onRankChanged?.(accountId))
  connection.on('settings:keyInvalid', () => handlers.onKeyInvalid?.())

  connection.onreconnected(() => log.info('Reconnected to the server'))
  connection.onclose((err) => {
    if (err) log.debug('Hub connection closed', { error: String(err) })
  })

  return {
    async start() {
      try {
        await connection.start()
        log.info('Listening to the server for updates')
      } catch (err) {
        log.debug('Could not open the hub connection', { error: String(err) })
      }
    },

    async stop() {
      try {
        await connection.stop()
      } catch {
        // Stopping a connection that was already broken is not worth reporting.
      }
    },

    get connected() {
      return connection.state === HubConnectionState.Connected
    }
  }
}
