import {
  DOUBLE_UP_QUEUE_ID,
  countedPlacement,
  isTopHalf,
  strongestTrait,
  type MatchSummary,
  type TftMatchSummary
} from '@foxfire/core'
import type { RecordingHeaderFacts } from '@foxfire/ui'

/** What the header says about a game, from its row in the player's history. */
export function headerFactsFor(match: MatchSummary | null | undefined, durationSeconds: number | null): RecordingHeaderFacts {
  return {
    championId: match?.championId ?? null,
    championName: match?.championName ?? null,
    queueId: match?.queueId ?? null,
    gameMode: match?.gameMode ?? null,
    durationSeconds: durationSeconds ?? match?.gameDuration ?? null,
    playedAt: match?.gameCreation ?? null,
    win: match ? match.win : null,
    kills: match?.kills ?? null,
    deaths: match?.deaths ?? null,
    assists: match?.assists ?? null
  }
}

/**
 * The same for a TFT game: its place where League has a score, and the board's
 * strongest trait and its carry — the most expensive, best-starred unit — where
 * League has a champion.
 */
export function tftHeaderFactsFor(
  match: Pick<
    TftMatchSummary,
    'queueId' | 'gameCreation' | 'placement' | 'teamPlacement' | 'timeEliminated' | 'traits' | 'units'
  >,
  durationSeconds: number | null
): RecordingHeaderFacts {
  const carry = match.units
    .slice()
    .sort((a, b) => b.rarity - a.rarity || b.tier - a.tier || b.items.length - a.items.length)[0]

  return {
    championId: null,
    championName: null,
    queueId: match.queueId,
    gameMode: 'TFT',
    // The player's own game, which ended when they were knocked out.
    durationSeconds: durationSeconds ?? match.timeEliminated,
    playedAt: match.gameCreation,
    win: isTopHalf(match, match.queueId),
    kills: null,
    deaths: null,
    assists: null,
    tft: {
      placement: countedPlacement(match, match.queueId),
      team: match.queueId === DOUBLE_UP_QUEUE_ID && match.teamPlacement !== null,
      trait: strongestTrait(match.traits)?.name ?? null,
      unit: carry?.characterId ?? null
    }
  }
}

/** Whether a history row is TFT's — it has a place where League's has a result. */
export const isTftRow = (row: MatchSummary | TftMatchSummary): row is TftMatchSummary => 'placement' in row
