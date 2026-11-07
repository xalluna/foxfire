import { strongestTrait, type TftMatchSummary } from '@foxfire/core'
import type { TftRecordingTitleFacts } from '@foxfire/core/youtube'
import type { LinkedTftMatchInfo, Recording } from './types'

/**
 * What a TFT recording's YouTube title is made from: the place it finished,
 * the team's in Double Up, and the trait its board is remembered by.
 *
 * Shared by the upload form's draft in main and the batch dialog's preview in
 * the renderer, so the two name a video the same way. `board` is the game as
 * far as it is known — the recording's own, or a server's row for it — and
 * `traitName` turns Riot's id into a name, from the manifest where there is one.
 */
export function tftTitleFacts(
  recording: Pick<Recording, 'queueId' | 'startedAt'>,
  board: Pick<LinkedTftMatchInfo | TftMatchSummary, 'queueId' | 'placement' | 'teamPlacement' | 'traits'> | null,
  traitName: (id: string) => string
): TftRecordingTitleFacts {
  const trait = board ? strongestTrait(board.traits) : null
  return {
    queueId: board?.queueId ?? recording.queueId,
    placement: board?.placement ?? null,
    teamPlacement: board?.teamPlacement ?? null,
    trait: trait ? traitName(trait.name) : null,
    playedAt: recording.startedAt
  }
}
