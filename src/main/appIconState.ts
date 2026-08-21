import type { CaptureStatus, LcuStatus } from '@shared/types'

/**
 * What the taskbar button is saying, derived from the two facts the app already
 * tracks: whether a game is on, and whether it is being recorded.
 *
 * The same convention the Live tab uses — see
 * src/renderer/src/components/LiveNavIcon.tsx, where teal means a game is on
 * and red means it is being kept. This adds a fourth state that has no in-app
 * equivalent on that icon: amber, for a game that is *not* being recorded when
 * it was meant to be.
 */
export type AppIconState = 'none' | 'game' | 'stalled' | 'recording'

/**
 * Recording is checked before anything else, and that ordering is the whole
 * point rather than a tidy-up.
 *
 * It is what "recording takes precedence" means literally. It also covers a
 * real gap: if the League client disappears mid-game the status becomes
 * `disconnected`, which carries no `inGame` field at all — so an inGame-first
 * check would read false immediately and the badge would drop from red to
 * nothing while OBS was still writing the file. captureService waits out a
 * 30-second GAME_LOST_MS backstop before it agrees the game is gone; this
 * keeps the badge honest for that half minute.
 *
 * Checking it first costs nothing in the ordinary case. `onRecordingStarted`
 * ignores anything Foxfire did not itself ask OBS to start, so a hand-rolled
 * OBS recording never lands here, and `gameEnded` leaves the recording phase
 * before the watcher clears `inGame`. Recording already implies a game is on.
 *
 * Amber is deliberately narrow. `error` is specifically "capture is enabled and
 * OBS is not reachable" — it is not every reason a game might go unrecorded
 * (no folder chosen, this queue not ticked, a scene OBS would reject all read
 * as idle, and show teal). And it is scoped to a game in progress: OBS being
 * shut while nobody is playing is the settings screen's business, and a badge
 * that sat amber all evening is one you would stop seeing.
 *
 * `connecting` is not amber either. OBS coming up is not OBS failing, and it
 * resolves in seconds — long enough to flash on every launch, which is exactly
 * the kind of noise that teaches you to ignore a colour.
 */
export function deriveAppIconState(lcu: LcuStatus, capture: CaptureStatus): AppIconState {
  if (capture.state === 'recording') return 'recording'

  const inGame = lcu.state === 'connected' && lcu.inGame
  if (!inGame) return 'none'

  if (capture.state === 'error') return 'stalled'
  return 'game'
}

/**
 * The tray tooltip for each state, and the badge's accessible description.
 *
 * One set of words for both: the tooltip is what you get on hover and the
 * description is what a screen reader announces for the overlay, and they
 * should not be able to disagree about what the colour means.
 */
export const APP_ICON_TOOLTIP: Record<AppIconState, string> = {
  none: 'Foxfire — tracking rank',
  game: 'Foxfire — game in progress',
  stalled: 'Foxfire — game in progress, not recording',
  recording: 'Foxfire — recording'
}
