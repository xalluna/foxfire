import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, desktopCapturer, ipcMain, session, type IpcMainEvent } from 'electron'
import { is } from '../../lib/env'
import { createLogger } from '../../telemetry/logger'
import { CAPTURE_AUDIO_CHANNELS as CH, type CaptureAudioStart } from '@shared/captureAudio'
import type { CaptureMicrophone } from '@shared/types'

/**
 * The PC's sound and the microphone, for the native recorder.
 *
 * FFmpeg has no way to capture what Windows plays, so this comes from Chromium
 * instead, in a hidden window (renderer/src/captureAudio) that exists only while
 * it is needed. Its session is its own, in memory, and is the only one in the
 * app allowed media: loopback audio through a display media request answered
 * here, and the microphone.
 */
const log = createLogger('capture')

const PARTITION = 'capture-audio'

/** Long enough for Windows to open both devices, short enough not to miss a game's start. */
const START_TIMEOUT_MS = 10_000

export interface AudioFeed {
  /** Receives every chunk of interleaved stereo float samples, in order. */
  onChunk(cb: (samples: Buffer) => void): void
  stop(): void
}

let window: BrowserWindow | null = null
let ready: Promise<BrowserWindow> | null = null
let chunkListener: ((samples: Buffer) => void) | null = null
let handlersInstalled = false

function fromOurPage(event: IpcMainEvent): boolean {
  return window !== null && !window.isDestroyed() && event.sender === window.webContents
}

/**
 * Installed once. Every other session keeps refusing media, and this one only
 * ever grants the loopback request its own page makes.
 */
function installHandlers(): void {
  if (handlersInstalled) return
  handlersInstalled = true

  const ses = session.fromPartition(PARTITION)
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    // A screen has to be named for the request to be granted, and the page
    // stops its video at once: only the audio is used.
    void desktopCapturer
      .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(([screen]) => callback(screen ? { video: screen, audio: 'loopback' } : {}))
      .catch(() => callback({}))
  })

  ipcMain.on(CH.chunk, (event, samples: ArrayBuffer) => {
    if (!fromOurPage(event)) return
    chunkListener?.(Buffer.from(samples))
  })
}

function pageUrl(): string {
  const devServer = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined
  if (devServer) return `${devServer}/capture-audio.html`
  return pathToFileURL(join(__dirname, '../renderer/capture-audio.html')).href
}

function openPage(): Promise<BrowserWindow> {
  if (ready) return ready
  installHandlers()

  const page = new BrowserWindow({
    show: false,
    webPreferences: {
      partition: PARTITION,
      preload: join(__dirname, '../preload/captureAudio.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Hidden windows are throttled by default, and so would be the samples.
      backgroundThrottling: false,
      // No gesture will ever happen on a page nobody sees.
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  window = page
  page.on('closed', () => {
    if (window === page) {
      window = null
      ready = null
    }
  })

  ready = page.loadURL(pageUrl()).then(
    () => page,
    (err) => {
      closePage()
      throw err
    }
  )
  return ready
}

function closePage(): void {
  const page = window
  window = null
  ready = null
  chunkListener = null
  if (page && !page.isDestroyed()) page.destroy()
}

/** Waits for one reply from the page, or gives up. */
function reply<T>(channel: string, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ipcMain.removeListener(channel, listener)
      reject(new Error('The audio capture page did not answer.'))
    }, timeoutMs)
    const listener = (event: IpcMainEvent, value: T): void => {
      if (!fromOurPage(event)) return
      clearTimeout(timer)
      ipcMain.removeListener(channel, listener)
      resolve(value)
    }
    ipcMain.on(channel, listener)
  })
}

/**
 * Starts capturing, and resolves once samples are flowing — or rejects with why
 * they cannot, which is a recording that cannot have the audio it was asked for.
 */
export async function startAudioCapture(options: CaptureAudioStart): Promise<AudioFeed> {
  const page = await openPage()

  const outcome = Promise.race([
    reply<void>(CH.started, START_TIMEOUT_MS).then(() => null),
    reply<string>(CH.failed, START_TIMEOUT_MS).then((message) => message)
  ])
  page.webContents.send(CH.start, options)

  const failure = await outcome.catch((err: unknown) => String(err))
  if (failure !== null) {
    closePage()
    log.warn('Audio capture would not start', { reason: failure })
    throw new Error(failure)
  }

  log.info('Audio capture started', { mic: options.mic })
  return {
    onChunk(cb) {
      chunkListener = cb
    },
    stop() {
      if (window === page && !page.isDestroyed()) page.webContents.send(CH.stop)
      closePage()
    }
  }
}

/** The microphones there are to choose from, by the page's own device ids. */
export async function listMicrophones(): Promise<CaptureMicrophone[]> {
  // Borrowed if a recording has it open, and closed again if it was opened for this.
  const wasOpen = window !== null
  try {
    const page = await openPage()
    const answer = reply<CaptureMicrophone[]>(CH.microphones, START_TIMEOUT_MS)
    page.webContents.send(CH.listMicrophones)
    return await answer
  } catch (err) {
    log.debug('Could not list microphones', { error: String(err) })
    return []
  } finally {
    if (!wasOpen) closePage()
  }
}
