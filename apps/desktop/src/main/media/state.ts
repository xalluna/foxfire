import { getAppIconState } from '../appIcon'
import { isUploadQuietPhase } from '../lcu/gameflow'
import { getGameflowPhase } from '../lcu/phase'

/**
 * Whether uploads should hold off because of a game.
 *
 * From champ select on, or while a recorder is rolling: an upload would
 * compete with the game for somebody's upstream, or with the recorder for
 * their disk. Checked between every chunk, so an upload that started in the
 * lobby stops within one chunk of the game starting.
 */
export function gameOrRecording(): boolean {
  return isUploadQuietPhase(getGameflowPhase()) || getAppIconState() === 'recording'
}
