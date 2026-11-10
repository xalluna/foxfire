/**
 * Foxfire Media's player control SDK, typed.
 *
 * Vendored from xalluna/foxfire-media's `sdk/foxfire-player.js` (commit
 * 364dd4f), which says to copy it into the app — it is dependency-free and has
 * no package. Kept to its protocol exactly: every message carries `foxfire: 1`;
 * the parent says `hello` until the player answers `connected`, then sends
 * `command`s with an id, and the player answers each with a `response` and
 * reports every change as an `event` carrying its whole state.
 *
 * The player accepts commands only from its parent window on one of the
 * application's AllowedOrigins, and sends events only to that origin. So
 * `origin` here is the frame's origin as this page reaches it: Foxfire Media's
 * own in a browser, and the relay's — this server's — on the desktop.
 */

export interface FoxfirePlayerState {
  /** Seconds. */
  currentTime: number
  /** Seconds (0 until metadata has loaded). */
  duration: number
  paused: boolean
  ended: boolean
  seeking: boolean
  muted: boolean
  /** 0 to 1. */
  volume: number
  playbackRate: number
  /** Buffered ranges as [start, end] seconds. */
  buffered: Array<[number, number]>
  /** HTMLMediaElement.readyState. */
  readyState: number
}

export type FoxfirePlayerEvent =
  | 'connected'
  | 'ready'
  | 'play'
  | 'pause'
  | 'timeupdate'
  | 'seeking'
  | 'seeked'
  | 'progress'
  | 'durationchange'
  | 'ended'
  | 'volumechange'
  | 'ratechange'
  | 'waiting'
  | 'error'

type Command = 'play' | 'pause' | 'seek' | 'setVolume' | 'setMuted' | 'setPlaybackRate' | 'getState'

interface Pending {
  resolve: (state: FoxfirePlayerState) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const HANDSHAKE_INTERVAL_MS = 250
const HANDSHAKE_TIMEOUT_MS = 20_000
const COMMAND_TIMEOUT_MS = 10_000

export class FoxfirePlayer {
  readonly iframe: HTMLIFrameElement
  readonly origin: string
  /** Last state reported by the player. */
  state: FoxfirePlayerState | null = null
  /** Resolves once metadata has loaded (duration known). */
  readonly ready: Promise<FoxfirePlayerState>

  private readonly listeners = new Map<FoxfirePlayerEvent, Set<(state: FoxfirePlayerState) => void>>()
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private connected = false
  private handshake: ReturnType<typeof setInterval> | undefined
  private resolveReady!: (state: FoxfirePlayerState) => void
  private rejectReady!: (error: Error) => void
  private readonly onMessage = (event: MessageEvent): void => this.handle(event)
  private readonly hello = (): void => {
    this.iframe.contentWindow?.postMessage({ foxfire: 1, type: 'hello' }, this.origin)
  }

  constructor(iframe: HTMLIFrameElement, options: { origin?: string } = {}) {
    this.iframe = iframe
    this.origin = options.origin ?? new URL(iframe.src, window.location.href).origin
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    // Nobody may be listening when it fails; the controller reads errors from events.
    this.ready.catch(() => undefined)

    window.addEventListener('message', this.onMessage)
    this.startHandshake()
  }

  /** Subscribes to an event; returns a function that unsubscribes. */
  on(event: FoxfirePlayerEvent, callback: (state: FoxfirePlayerState) => void): () => void {
    let set = this.listeners.get(event)
    if (!set) this.listeners.set(event, (set = new Set()))
    set.add(callback)
    return () => this.listeners.get(event)?.delete(callback)
  }

  play(): Promise<FoxfirePlayerState> {
    return this.command('play')
  }

  pause(): Promise<FoxfirePlayerState> {
    return this.command('pause')
  }

  /** Seeks to a time in seconds (clamped to the video). */
  seek(seconds: number): Promise<FoxfirePlayerState> {
    return this.command('seek', seconds)
  }

  /** Volume from 0 to 1. */
  setVolume(volume: number): Promise<FoxfirePlayerState> {
    return this.command('setVolume', volume)
  }

  setMuted(muted: boolean): Promise<FoxfirePlayerState> {
    return this.command('setMuted', muted)
  }

  /** Playback speed from 0.25 to 4. */
  setPlaybackRate(rate: number): Promise<FoxfirePlayerState> {
    return this.command('setPlaybackRate', rate)
  }

  getState(): Promise<FoxfirePlayerState> {
    return this.command('getState')
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage)
    this.iframe.removeEventListener('load', this.hello)
    clearInterval(this.handshake)
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error('Player destroyed.'))
    }
    this.pending.clear()
    this.listeners.clear()
  }

  private startHandshake(): void {
    const started = Date.now()
    this.handshake = setInterval(() => {
      if (this.connected) {
        clearInterval(this.handshake)
      } else if (Date.now() - started > HANDSHAKE_TIMEOUT_MS) {
        clearInterval(this.handshake)
        this.rejectReady(new Error('The player did not respond.'))
        this.emit('error', this.state ?? EMPTY_STATE)
      } else {
        this.hello()
      }
    }, HANDSHAKE_INTERVAL_MS)
    this.iframe.addEventListener('load', this.hello)
    this.hello()
  }

  private command(command: Command, value?: unknown): Promise<FoxfirePlayerState> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`'${command}' timed out.`))
      }, COMMAND_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.iframe.contentWindow?.postMessage({ foxfire: 1, type: 'command', id, command, value }, this.origin)
    })
  }

  private emit(event: FoxfirePlayerEvent, state: FoxfirePlayerState): void {
    for (const callback of this.listeners.get(event) ?? []) {
      try {
        callback(state)
      } catch (error) {
        console.error(error)
      }
    }
  }

  private handle(event: MessageEvent): void {
    if (event.source !== this.iframe.contentWindow || event.origin !== this.origin) return
    const message = event.data as {
      foxfire?: unknown
      type?: string
      event?: FoxfirePlayerEvent
      id?: number
      ok?: boolean
      error?: string
      state?: FoxfirePlayerState
    } | null
    if (!message || message.foxfire !== 1) return
    if (message.state) this.state = message.state

    if (message.type === 'connected') {
      this.connected = true
      if (message.state) this.emit('connected', message.state)
    } else if (message.type === 'event' && message.event) {
      if (message.event === 'ready' && message.state) this.resolveReady(message.state)
      this.emit(message.event, message.state ?? this.state ?? EMPTY_STATE)
    } else if (message.type === 'response' && typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.ok && message.state) pending.resolve(message.state)
      else pending.reject(new Error(message.error ?? 'Command failed.'))
    }
  }
}

const EMPTY_STATE: FoxfirePlayerState = {
  currentTime: 0,
  duration: 0,
  paused: true,
  ended: false,
  seeking: false,
  muted: false,
  volume: 1,
  playbackRate: 1,
  buffered: [],
  readyState: 0
}
