// Pure mapping from Riot's spectator payload to the rows the live game screen
// draws. Deliberately free of any database or network imports so it stays
// trivially testable, in the manner of syncPlanning.ts.

import type { ActiveGameDto } from '../riot/types'
import type { Account, LiveGameParticipant } from '@shared/types'

/** Riot's spectator payload carries "gameName#tagLine" as a single string on newer responses. */
function splitRiotId(riotId: string | null | undefined): {
  gameName: string | null
  tagLine: string | null
} {
  if (!riotId) return { gameName: null, tagLine: null }
  const idx = riotId.lastIndexOf('#')
  if (idx === -1) return { gameName: riotId, tagLine: null }
  return { gameName: riotId.slice(0, idx), tagLine: riotId.slice(idx + 1) }
}

/**
 * Riot hides some players' identities, and every field it sends is optional as
 * far as the schema is concerned, so nothing here may assume a field arrived.
 *
 * A participant with no riotId is anonymous, and its puuid is dropped rather
 * than passed along — hand the renderer a puuid and it can resolve the name and
 * rank the API deliberately withheld. The one exception is the tracked account
 * itself: the app already knows who you are without asking Riot.
 */
export function toLiveGameParticipants(
  game: ActiveGameDto,
  account: Account
): LiveGameParticipant[] {
  const half = game.participants.length / 2

  return game.participants.map((p, i) => {
    // Riot lists blue's five before red's, so position stands in for a missing
    // teamId and neither side loses a slot.
    const slot = {
      slot: i,
      teamId: p.teamId ?? (i < half ? 100 : 200),
      championId: p.championId ?? null,
      spell1Id: p.spell1Id ?? null,
      spell2Id: p.spell2Id ?? null
    }

    if (p.puuid && p.puuid === account.puuid) {
      return {
        ...slot,
        anonymous: false,
        puuid: p.puuid,
        gameName: account.gameName,
        tagLine: account.tagLine
      }
    }

    const { gameName, tagLine } = splitRiotId(p.riotId)
    if (gameName === null) {
      return { ...slot, anonymous: true, puuid: null, gameName: null, tagLine: null }
    }

    return { ...slot, anonymous: false, puuid: p.puuid ?? null, gameName, tagLine }
  })
}
