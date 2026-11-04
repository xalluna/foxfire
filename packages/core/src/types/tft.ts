/**
 * The shapes of TFT data every Foxfire client reads.
 *
 * Their own types rather than nullable League fields, because almost nothing
 * carries over: a TFT game has a placement rather than a result, a board of
 * units rather than a champion, and traits rather than runes. What does carry
 * over — the LP chip, the recording, this machine's files — is the same shape
 * as League's, so the pieces that draw them do not care which game they are in.
 *
 * Unit, trait, item and augment ids are Riot's, as tft-match-v1 spells them
 * (`TFT13_Jinx`, `TFT_Item_InfinityEdge`); a client names and draws them from
 * the Data Dragon TFT manifest, and falls back to the id when the manifest is
 * of a different set.
 */

import type { TftLadder } from '../games/ladders'
import type {
  Account,
  EditableMatchBase,
  LeagueEntry,
  LocalArtefacts,
  MatchRankInfo,
  MatchRecordingSummary,
  SyncState
} from './domain'

/** One trait on a board. */
export interface TftTrait {
  /** `TFT13_Ambusher` */
  name: string
  numUnits: number
  /**
   * How it is drawn, 0 to 4: inactive, bronze, silver, gold, prismatic.
   *
   * Riot's own number, and unrelated to how many breakpoints the trait has —
   * a unique trait is gold at its only breakpoint.
   */
  style: number
  tierCurrent: number
  tierTotal: number
}

/** One unit on a board. */
export interface TftUnit {
  /** `TFT13_Jinx` */
  characterId: string
  /** Star level, 1 to 3 (4 for the rare four-star). */
  tier: number
  /** Riot's rarity, which is not the cost: see unitCost. */
  rarity: number
  /** Item ids, in the order they were slotted. */
  items: string[]
}

/** How a board finished, as a row and a lobby both read it. */
export interface TftBoard {
  /** 1 to 8, the player's own. */
  placement: number
  /**
   * 1 to 4 in Double Up, the team's: two players finish together. Null in
   * every other queue.
   */
  teamPlacement: number | null
  level: number
  /** Riot's running count, which the client shows as a stage: see stageOfRound. */
  lastRound: number
  /** Seconds from the start until this player was knocked out, or the game ended. */
  timeEliminated: number
  playersEliminated: number
  totalDamageToPlayers: number
  goldLeft: number
  traits: TftTrait[]
  units: TftUnit[]
  augments: string[]
}

/** One row of TFT match history: one player's board in one game. */
export interface TftMatchSummary extends TftBoard {
  matchId: string
  gameCreation: number
  /** Seconds, the whole lobby's — longer than this player's own when they went out early. */
  gameDuration: number
  queueId: number | null
  /** The set the game was played in. */
  setNumber: number | null
  /** As League's: null for an unranked queue, or one no LP could be attributed to. */
  rank: MatchRankInfo | null
  hasManualRank: boolean
  /** The YouTube recording a server holds for this player's view of this game. */
  recording?: MatchRecordingSummary | null
  /** This machine's files for the game; the desktop's alone. */
  local?: LocalArtefacts
}

/** One of the eight boards in a lobby. */
export interface TftLobbyParticipant extends TftBoard {
  puuid: string
  /** Null for a payload that predates Riot IDs on TFT participants. */
  gameName: string | null
  tagLine: string | null
  /** The account this server or machine tracks for the player, when it tracks one. */
  accountId: string | null
  partnerGroupId: number | null
}

/** Everybody's board in one game, best placement first. */
export interface TftLobby {
  matchId: string
  gameCreation: number
  gameDuration: number
  queueId: number | null
  setNumber: number | null
  participants: TftLobbyParticipant[]
}

/**
 * How one ladder's games have finished this set.
 *
 * Counted over every stored game on the ladder inside the current TFT season,
 * by whoever holds the games — never from the page of history a screen happens
 * to have loaded.
 */
export interface TftLadderSummary {
  queueType: TftLadder
  games: number
  /**
   * How many games finished in each place, first place first: eight places,
   * or four in Double Up, where the team's placement is what counts.
   */
  placements: number[]
  /** Null with no games. */
  averagePlacement: number | null
  /** The share of games in the top half — top four, or top two teams. Null with no games. */
  topRate: number | null
}

/**
 * Whether the Riot key behind this account's history can reach TFT.
 *
 * Riot ties a key to a product, so a key registered for League alone is
 * refused by every TFT endpoint. Unknown until somebody has asked.
 */
export type TftAccess = 'unknown' | 'granted' | 'denied'

/** Everything the TFT profile header needs, in one answer. */
export interface TftDashboard {
  account: Account
  /** TFT's ladders only. */
  leagueEntries: LeagueEntry[]
  syncState: SyncState | null
  /** One per ladder, in picker order. */
  ladders: TftLadderSummary[]
  /** The current TFT season's label, or null when none is entered. */
  seasonLabel: string | null
  tftAccess: TftAccess
}

/** A ranked TFT game with no attributed LP, offered for hand-entry. */
export interface TftEditableMatch extends EditableMatchBase {
  queueId: number
  placement: number
  teamPlacement: number | null
}
