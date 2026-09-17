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
export type CaptureQuality = '720p30' | '720p60' | '1080p30' | '1080p60'

export interface CaptureQualityOption {
  value: CaptureQuality
  label: string
  width: number
  height: number
  fps: number
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
  }
]

export const DEFAULT_CAPTURE_QUALITY: CaptureQuality = '1080p60'

export function captureQualityOption(quality: CaptureQuality): CaptureQualityOption {
  return (
    CAPTURE_QUALITY_OPTIONS.find((option) => option.value === quality) ??
    CAPTURE_QUALITY_OPTIONS[CAPTURE_QUALITY_OPTIONS.length - 1]!
  )
}
