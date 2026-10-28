/**
 * What managed mode records at.
 *
 * Resolution and frame rate together, because they are the two things that
 * decide both how hard the encoder works and how much disk a game costs, and
 * offering them as separate controls invites combinations nobody wants. A
 * machine that struggles with the game itself needs to turn both down.
 *
 * Shared so the settings screen and the OBS provisioning cannot disagree about
 * what an option means.
 */
export type CaptureQuality = '720p30' | '720p60' | '1080p30' | '1080p60' | '1080pDisplay' | '1440pDisplay'

export interface CaptureQualityOption {
  value: CaptureQuality
  label: string
  width: number
  height: number
  /**
   * Frames per second, or 'display': the refresh rate of the fastest monitor,
   * so every frame the game showed is kept. Taking 60 from a 144 Hz game
   * spaces them unevenly — two refreshes apart, then three — and the footage
   * judders in a way the game never did.
   */
  fps: number | 'display'
  /** Only the native recorder can follow the display; OBS records these at 60. */
  nativeOnly?: boolean
  /**
   * Rough disk cost, for the settings screen.
   *
   * Measured against a real recording rather than guessed: an ARAM at 720p30
   * came out at 2.6 GB/hour on OBS's default constant 6 Mbps. These are for the
   * quality preset used here, which varies its bitrate with the picture, so a
   * quiet laning phase costs less and a teamfight more.
   */
  approxGbPerHour: number
  hint: string
}

/**
 * OBS's own name for the recording quality preset, in Simple output mode.
 *
 * 'Small' is the one OBS labels "High Quality, Medium File Size" — the naming
 * is genuinely inverted, and 'HQ' is "Indistinguishable Quality, Large File
 * Size", which is several times the size for detail nobody reviewing a game
 * would see. Fixed rather than exposed: the resolution and frame rate below are
 * the levers worth giving anybody.
 */
export const OBS_RECORD_QUALITY = 'Small'

export const CAPTURE_QUALITY_OPTIONS: readonly CaptureQualityOption[] = [
  {
    value: '720p30',
    label: '720p 30fps',
    width: 1280,
    height: 720,
    fps: 30,
    approxGbPerHour: 1.5,
    hint: 'Lightest. For a machine that already struggles to hold frames in game.'
  },
  {
    value: '720p60',
    label: '720p 60fps',
    width: 1280,
    height: 720,
    fps: 60,
    approxGbPerHour: 2.5,
    hint: 'Soft picture, but movement and animation timing stay readable.'
  },
  {
    value: '1080p30',
    label: '1080p 30fps',
    width: 1920,
    height: 1080,
    fps: 30,
    approxGbPerHour: 3,
    hint: 'Sharp enough to read the HUD and minimap. Skillshot timing suffers.'
  },
  {
    value: '1080p60',
    label: '1080p 60fps',
    width: 1920,
    height: 1080,
    fps: 60,
    approxGbPerHour: 5,
    hint: 'Recommended. Shows dodges and animation cancels, which is most of what footage is for.'
  },
  {
    value: '1080pDisplay',
    label: '1080p at your refresh rate',
    width: 1920,
    height: 1080,
    fps: 'display',
    nativeOnly: true,
    // At 144 Hz. More frames cost less than their number suggests: the closer
    // together they are, the less each one differs from the last.
    approxGbPerHour: 9,
    hint: 'Every frame your monitor shows, so motion looks the way it did in game. Disk figures are at 144 Hz.'
  },
  {
    value: '1440pDisplay',
    label: '1440p at your refresh rate',
    width: 2560,
    height: 1440,
    fps: 'display',
    nativeOnly: true,
    approxGbPerHour: 14,
    hint: 'What a 1440p monitor shows, frame for frame. The heaviest on disk and on the encoder. Disk figures are at 144 Hz.'
  }
]

export const DEFAULT_CAPTURE_QUALITY: CaptureQuality = '1080p60'

/** The refresh rate a 'display' preset's disk figure is quoted at. */
export const DISPLAY_PRESET_REFERENCE_HZ = 144

export function captureQualityOption(quality: CaptureQuality): CaptureQualityOption {
  return (
    CAPTURE_QUALITY_OPTIONS.find((option) => option.value === quality) ??
    CAPTURE_QUALITY_OPTIONS.find((option) => option.value === DEFAULT_CAPTURE_QUALITY)!
  )
}

/** The frame rate a preset records at, given the display's. */
export function presetFps(option: Pick<CaptureQualityOption, 'fps'>, displayHz: number): number {
  return option.fps === 'display' ? displayHz : option.fps
}
