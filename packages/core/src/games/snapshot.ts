/**
 * The registry and the TFT rules, as fixtures/game-registry.json records them.
 *
 * Built here rather than in the generator script so the test that checks the
 * file is current builds exactly the same thing. Not exported from the
 * package: nothing but the generator and that test reads it.
 */

import { GAMES, GAME_IDS } from './registry'
import { LADDERS, LADDER_IDS } from './ladders'
import { ratedMovement, RATED_TIERS, RATED_TIER_FLOORS } from '../rules/ratedLadder'
import { teamPlacements, tftGameEndMs, type PlacedPlayer } from '../rules/tft'

const TEAM_LOBBIES: Array<{ name: string; players: PlacedPlayer[] }> = [
  {
    name: 'individual places, teams in order',
    players: [
      { puuid: 'a', placement: 1, partnerGroupId: 1 },
      { puuid: 'b', placement: 2, partnerGroupId: 1 },
      { puuid: 'c', placement: 3, partnerGroupId: 2 },
      { puuid: 'd', placement: 4, partnerGroupId: 2 },
      { puuid: 'e', placement: 5, partnerGroupId: 3 },
      { puuid: 'f', placement: 6, partnerGroupId: 3 },
      { puuid: 'g', placement: 7, partnerGroupId: 4 },
      { puuid: 'h', placement: 8, partnerGroupId: 4 }
    ]
  },
  {
    name: 'individual places, partners apart',
    players: [
      { puuid: 'a', placement: 1, partnerGroupId: 3 },
      { puuid: 'b', placement: 6, partnerGroupId: 3 },
      { puuid: 'c', placement: 2, partnerGroupId: 1 },
      { puuid: 'd', placement: 3, partnerGroupId: 1 },
      { puuid: 'e', placement: 4, partnerGroupId: 4 },
      { puuid: 'f', placement: 8, partnerGroupId: 4 },
      { puuid: 'g', placement: 5, partnerGroupId: 2 },
      { puuid: 'h', placement: 7, partnerGroupId: 2 }
    ]
  },
  {
    name: 'shared team places',
    players: [
      { puuid: 'a', placement: 2, partnerGroupId: 9 },
      { puuid: 'b', placement: 2, partnerGroupId: 9 },
      { puuid: 'c', placement: 1, partnerGroupId: 4 },
      { puuid: 'd', placement: 1, partnerGroupId: 4 },
      { puuid: 'e', placement: 4, partnerGroupId: 2 },
      { puuid: 'f', placement: 4, partnerGroupId: 2 },
      { puuid: 'g', placement: 3, partnerGroupId: 7 },
      { puuid: 'h', placement: 3, partnerGroupId: 7 }
    ]
  },
  {
    name: 'a tie broken by group id, and a player with no team',
    players: [
      { puuid: 'a', placement: 1, partnerGroupId: 5 },
      { puuid: 'b', placement: 1, partnerGroupId: 2 },
      { puuid: 'c', placement: 3, partnerGroupId: null }
    ]
  }
]

const RATED_PAIRS: Array<[string | null, string | null]> = [
  ...RATED_TIERS.flatMap((before) => RATED_TIERS.map((after) => [before, after] as [string, string])),
  [null, 'BLUE'],
  ['BLUE', null],
  ['BLUE', 'TEAL']
]

const GAME_ENDS: Array<{ gameCreation: number; timeEliminated: number | null; gameDuration: number }> = [
  { gameCreation: 1_790_000_000_000, timeEliminated: 1712.38, gameDuration: 2216 },
  { gameCreation: 1_790_000_000_000, timeEliminated: 0.4, gameDuration: 2216 },
  { gameCreation: 1_790_000_000_000, timeEliminated: 1712.5, gameDuration: 2216 },
  { gameCreation: 1_790_000_000_000, timeEliminated: null, gameDuration: 2216 }
]

export function gameRegistrySnapshot() {
  return {
    games: GAME_IDS.map((id) => ({
      id,
      folder: GAMES[id].folder,
      keyScope: GAMES[id].keyScope,
      queues: GAMES[id].queues.map((q) => ({ id: q.id, folder: q.folder })),
      postGameRetryMs: GAMES[id].postGameRetryMs
    })),
    ladders: LADDER_IDS.map((id) => ({
      id,
      game: LADDERS[id].game,
      queueId: LADDERS[id].queueId,
      scale: LADDERS[id].scale,
      lpEditable: LADDERS[id].lpEditable,
      placementSlots: LADDERS[id].placementSlots
    })),
    ratedTierFloors: RATED_TIERS.map((tier) => ({ tier, floor: RATED_TIER_FLOORS[tier] })),
    teamPlacements: TEAM_LOBBIES.map((lobby) => ({
      ...lobby,
      teams: Object.fromEntries(teamPlacements(lobby.players))
    })),
    ratedMovements: RATED_PAIRS.map(([before, after]) => ({ before, after, movement: ratedMovement(before, after) })),
    gameEnds: GAME_ENDS.map((g) => ({ ...g, end: tftGameEndMs(g.gameCreation, g.timeEliminated, g.gameDuration) }))
  }
}
