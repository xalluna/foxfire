import type { AppIconState } from '../appIconState'
import type { UpdateBlocker } from '@shared/types'

/**
 * Whether restarting right now would cost something, and what.
 *
 * Read off the same state the taskbar badge and the tray tooltip are drawn
 * from, rather than asking the LCU watcher and the capture service separately:
 * those two already agree on one answer in appIconState.ts, and a restart
 * offer that disagreed with the badge the user is looking at would be the
 * worse of the two to be wrong.
 *
 * Both flavours of "a game is on" block. `stalled` is a game in progress that
 * OBS is not recording — the recording is already lost, but the LP reading at
 * the end of the game is not, and that is the thing Foxfire was left running
 * for.
 */
export function blockerFor(state: AppIconState): UpdateBlocker | null {
  if (state === 'recording') return 'recording'
  return state === 'none' ? null : 'game'
}
