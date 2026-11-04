import {
  CAPTURE_AUDIO_CHUNK_MS,
  CAPTURE_AUDIO_SAMPLE_RATE,
  type CaptureAudioBridge,
  type CaptureAudioStart
} from '@shared/captureAudio'

/**
 * The native recorder's ears, in a window nobody sees.
 *
 * FFmpeg cannot capture what a Windows PC plays, and Chromium can: the display
 * media request main answers for this page grants loopback audio, the whole
 * output mix. The microphone, when wanted, is an ordinary getUserMedia. Web
 * Audio adds the two together, and a worklet hands the mix to main in short
 * chunks of interleaved float samples, which main writes to FFmpeg's stdin.
 *
 * The AudioContext runs on the output device's clock, so the stream keeps
 * flowing through silence — loopback itself delivers nothing while nothing
 * plays — and FFmpeg's timestamps never see a gap that is not really there.
 */

declare global {
  interface Window {
    captureAudio: CaptureAudioBridge
  }
}

const bridge = window.captureAudio

const FRAMES_PER_CHUNK = (CAPTURE_AUDIO_SAMPLE_RATE * CAPTURE_AUDIO_CHUNK_MS) / 1000

/** −120 dBFS: not zero, which is all Chromium checks, and nothing anybody could hear. */
const INAUDIBLE_LEVEL = 1e-6

/**
 * Collects the render quantum's 128 frames at a time into stereo chunks.
 *
 * A string rather than a module of its own: a worklet is loaded by URL, and a
 * Blob URL keeps it inside this one page instead of adding a build entry.
 */
const TAP_WORKLET = `
class FoxfireTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.chunk = new Float32Array(${FRAMES_PER_CHUNK * 2})
    this.filled = 0
  }
  process(inputs) {
    const input = inputs[0] || []
    const left = input[0]
    const right = input[1] || left
    const frames = left ? left.length : 128
    for (let i = 0; i < frames; i++) {
      this.chunk[this.filled++] = left ? left[i] : 0
      this.chunk[this.filled++] = right ? right[i] : 0
      if (this.filled === this.chunk.length) {
        this.port.postMessage(this.chunk.buffer, [this.chunk.buffer])
        this.chunk = new Float32Array(${FRAMES_PER_CHUNK * 2})
        this.filled = 0
      }
    }
    return true
  }
}
registerProcessor('foxfire-tap', FoxfireTap)
`

let running: { context: AudioContext; streams: MediaStream[] } | null = null

async function start(options: CaptureAudioStart): Promise<void> {
  stop()

  const streams: MediaStream[] = []
  try {
    // Video must be asked for — getDisplayMedia refuses audio alone — and is
    // dropped at once: the picture is FFmpeg's, from the game's own window.
    const display = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      // Untouched, as the microphone is below. Asked for as plain `true`,
      // Chromium processes the PC's sound as if it were a call: mixed down to
      // mono, run through automatic gain control — quiet passages pushed up,
      // loud ones squeezed under its limiter — and noise suppression, which
      // takes game sound for noise. Every native recording made that way was
      // mono and pumping, and sounded blown out.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    })
    streams.push(display)
    for (const track of display.getVideoTracks()) track.stop()
    const [loopback] = display.getAudioTracks()
    if (!loopback) throw new Error("Windows gave no access to the PC's sound.")

    const context = new AudioContext({ sampleRate: CAPTURE_AUDIO_SAMPLE_RATE, latencyHint: 'interactive' })
    running = { context, streams }

    const workletUrl = URL.createObjectURL(new Blob([TAP_WORKLET], { type: 'text/javascript' }))
    await context.audioWorklet.addModule(workletUrl)
    URL.revokeObjectURL(workletUrl)

    const tap = new AudioWorkletNode(context, 'foxfire-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    })
    tap.port.onmessage = (event: MessageEvent<ArrayBuffer>) => bridge.chunk(event.data)

    // Everything connected to one input is summed: that is the mix.
    context.createMediaStreamSource(new MediaStream([loopback])).connect(tap)

    if (options.mic) {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: options.micDeviceId ? { exact: options.micDeviceId } : undefined,
          // A voice recorded beside game audio, not a call: processing meant
          // for calls ducks and gates it against the game it is mixed with.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      })
      streams.push(mic)
      context.createMediaStreamSource(mic).connect(tap)
    }

    // Pulled by the destination so the graph renders, at zero gain so nothing
    // this page hears is played back — which loopback would then hear again.
    const silence = context.createGain()
    silence.gain.value = 0
    tap.connect(silence).connect(context.destination)

    // And never quite silent. Chromium watches what a page plays, and after 30
    // seconds of exact zeros it stops running the page's audio off the sound
    // card and runs it off a timer instead (SilentSinkSuspender), to save
    // power. That timer does not always keep time: two native recordings lost
    // a quarter of their sound from 30 seconds in, a tenth of a second at a
    // time, which FFmpeg filled with silence. A constant far below anything
    // audible keeps the sound card in charge for the whole game.
    const keepAwake = context.createConstantSource()
    keepAwake.offset.value = INAUDIBLE_LEVEL
    keepAwake.connect(context.destination)
    keepAwake.start()

    await context.resume()
    bridge.started()
  } catch (err) {
    for (const stream of streams) for (const track of stream.getTracks()) track.stop()
    stop()
    bridge.failed(err instanceof Error ? err.message : String(err))
  }
}

function stop(): void {
  if (!running) return
  const { context, streams } = running
  running = null
  for (const stream of streams) for (const track of stream.getTracks()) track.stop()
  void context.close()
}

async function listMicrophones(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    bridge.microphones(
      devices
        // 'default' and 'communications' are Windows' aliases for a real device
        // that is listed in its own right; the setting's null already means default.
        .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }))
    )
  } catch {
    bridge.microphones([])
  }
}

bridge.onStart((options) => void start(options))
bridge.onStop(stop)
bridge.onListMicrophones(() => void listMicrophones())
