import type { DatabaseSync } from 'node:sqlite'
import { teamPlacements, type TftFinish } from '@foxfire/core'
import type {
  MatchRankInfo,
  TftLobby,
  TftLobbyParticipant,
  TftMatchSummary,
  TftTrait,
  TftUnit
} from '@foxfire/core'
import type { TftMatchDto } from '../../riot/types'
import { PENDING_UPLOAD_STATES } from './recordings.repo'

/*
 * TFT's games, on this PC.
 *
 * A TFT game is a row in `matches` like any other — game 'tft' — with every
 * board in `tft_participants`. Nothing here touches match_participants, so no
 * League read can see a TFT game, and the reverse.
 *
 * Boards are filed under the puuid of whichever key fetched them: the main
 * key's, or a TFT key's when this PC has one. The caller says which; see
 * services/tftIdentity.ts.
 */

/** When the lobby was created: Riot's own figure, or worked back from the end when the payload predates it. */
export function tftCreationOf(info: TftMatchDto['info']): number {
  return info.gameCreation !== undefined && info.gameCreation > 0
    ? info.gameCreation
    : info.game_datetime - Math.round(info.game_length * 1000)
}

/**
 * Stores one TFT game and all eight boards, with Double Up's team places
 * worked out from the whole lobby on the way in. A game already stored is left
 * as it is.
 */
export function insertTftMatch(db: DatabaseSync, match: TftMatchDto, rawJson: string): void {
  const { info } = match
  const matchId = match.metadata.match_id
  const queueId = info.queueId ?? info.queue_id ?? null
  const platformId = matchId.includes('_') ? matchId.slice(0, matchId.indexOf('_')) : null
  const teams = teamPlacements(
    info.participants.map((p) => ({ puuid: p.puuid, placement: p.placement, partnerGroupId: p.partner_group_id ?? null }))
  )

  db.exec('BEGIN')
  try {
    const inserted = db
      .prepare(
        `INSERT OR IGNORE INTO matches
           (match_id, game, game_creation, game_duration, game_mode, game_type, queue_id, platform_id,
            raw_json, tft_set_number, tft_set_core_name)
         VALUES (?, 'tft', ?, ?, 'TFT', ?, ?, ?, ?, ?, ?)`
      )
      .run(
        matchId,
        tftCreationOf(info),
        Math.round(info.game_length),
        info.tft_game_type ?? null,
        queueId,
        platformId,
        rawJson,
        info.tft_set_number ?? null,
        info.tft_set_core_name ?? null
      )

    if (Number(inserted.changes) > 0) {
      const board = db.prepare(
        `INSERT OR REPLACE INTO tft_participants
           (match_id, puuid, game_name, tag_line, placement, team_placement, partner_group_id, level,
            last_round, time_eliminated, players_eliminated, total_damage_to_players, gold_left, win,
            traits_json, units_json, augments_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )

      for (const p of info.participants) {
        const traits: TftTrait[] = p.traits.map((t) => ({
          name: t.name,
          numUnits: t.num_units,
          style: t.style,
          tierCurrent: t.tier_current,
          tierTotal: t.tier_total
        }))
        const units: TftUnit[] = p.units.map((u) => ({
          characterId: u.character_id,
          tier: u.tier,
          rarity: u.rarity,
          items: u.itemNames ?? []
        }))

        board.run(
          matchId,
          p.puuid,
          p.riotIdGameName ?? null,
          p.riotIdTagline ?? null,
          p.placement,
          teams.get(p.puuid) ?? null,
          p.partner_group_id ?? null,
          p.level,
          p.last_round,
          // Where the game is placed among rank readings. A board Riot sent
          // without one lasted the lobby as far as anybody can tell — stored as
          // 0 it would place the game at its own start.
          p.time_eliminated ?? info.game_length,
          p.players_eliminated,
          p.total_damage_to_players,
          p.gold_left,
          // Riot's own top-four flag when it sent one; the place says the same when not.
          (p.win ?? p.placement <= 4) ? 1 : 0,
          JSON.stringify(traits),
          JSON.stringify(units),
          p.augments && p.augments.length > 0 ? JSON.stringify(p.augments) : null
        )
      }
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

interface BoardRow {
  placement: number
  team_placement: number | null
  level: number
  last_round: number
  time_eliminated: number
  players_eliminated: number
  total_damage_to_players: number
  gold_left: number
  traits_json: string
  units_json: string
  augments_json: string | null
}

function boardOf(row: BoardRow) {
  return {
    placement: row.placement,
    teamPlacement: row.team_placement,
    level: row.level,
    lastRound: row.last_round,
    timeEliminated: row.time_eliminated,
    playersEliminated: row.players_eliminated,
    totalDamageToPlayers: row.total_damage_to_players,
    goldLeft: row.gold_left,
    traits: JSON.parse(row.traits_json) as TftTrait[],
    units: JSON.parse(row.units_json) as TftUnit[],
    augments: row.augments_json ? (JSON.parse(row.augments_json) as string[]) : []
  }
}

interface SummaryRow extends BoardRow {
  match_id: string
  game_creation: number
  game_duration: number
  queue_id: number | null
  tft_set_number: number | null
  lp_delta: number | null
  tier_before: string | null
  rank_before: string | null
  tier_after: string | null
  rank_after: string | null
  is_promotion: number | null
  is_demotion: number | null
  rated_tier_before: string | null
  rated_tier_after: string | null
  has_manual_rank: number
  recording_id: number | null
  recording_video_id: string | null
  recording_upload_pending: number | null
}

function rankOf(row: SummaryRow): MatchRankInfo | null {
  if (row.is_promotion === null) return null
  return {
    lpDelta: row.lp_delta,
    tierBefore: row.tier_before,
    rankBefore: row.rank_before,
    tierAfter: row.tier_after,
    rankAfter: row.rank_after,
    isPromotion: row.is_promotion === 1,
    isDemotion: row.is_demotion === 1,
    ...(row.rated_tier_before !== null || row.rated_tier_after !== null
      ? { ratedTierBefore: row.rated_tier_before, ratedTierAfter: row.rated_tier_after }
      : {})
  }
}

/**
 * One account's TFT history rows, with the LP each moved and what this PC holds
 * of it.
 *
 * Takes the account id as well as the puuid, unlike League's, because a TFT
 * board can be filed under an id the accounts table does not hold — a TFT
 * key's — so the account cannot be found from the board.
 */
const SUMMARY_SQL = `
  SELECT m.match_id, m.game_creation, m.game_duration, m.queue_id, m.tft_set_number,
         p.placement, p.team_placement, p.level, p.last_round, p.time_eliminated,
         p.players_eliminated, p.total_damage_to_players, p.gold_left,
         p.traits_json, p.units_json, p.augments_json,
         mr.lp_delta, mr.tier_before, mr.rank_before, mr.tier_after, mr.rank_after,
         mr.is_promotion, mr.is_demotion, mr.rated_tier_before, mr.rated_tier_after,
         EXISTS (SELECT 1 FROM rank_snapshots rs
                  WHERE rs.match_id = m.match_id AND rs.source = 'manual' AND rs.account_id = :account)
           AS has_manual_rank,
         (SELECT rp.id FROM recordings rp
           WHERE rp.match_id = m.match_id AND rp.account_id = :accountText
           ORDER BY rp.id DESC LIMIT 1) AS recording_id,
         (SELECT rp.youtube_video_id FROM recordings rp
           WHERE rp.match_id = m.match_id AND rp.account_id = :accountText
           ORDER BY rp.id DESC LIMIT 1) AS recording_video_id,
         (SELECT 1 FROM recordings rp
            JOIN youtube_uploads yu ON yu.recording_id = rp.id
           WHERE rp.match_id = m.match_id AND rp.account_id = :accountText
             AND yu.state IN (${PENDING_UPLOAD_STATES})
           LIMIT 1) AS recording_upload_pending
    FROM tft_participants p
    JOIN matches m ON m.match_id = p.match_id
    LEFT JOIN match_rank mr ON mr.match_id = p.match_id AND mr.account_id = :account`

function toSummary(row: SummaryRow): TftMatchSummary {
  return {
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    queueId: row.queue_id,
    setNumber: row.tft_set_number,
    ...boardOf(row),
    rank: rankOf(row),
    hasManualRank: row.has_manual_rank === 1,
    recording: null,
    local: {
      recordingId: row.recording_id,
      recordingVideoId: row.recording_video_id,
      recordingUploadPending: row.recording_upload_pending === 1,
      // A Riot replay is League's alone.
      replayId: null
    }
  }
}

export function getTftMatchSummaries(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  limit: number,
  offset: number,
  queueId: number | null = null
): TftMatchSummary[] {
  const rows = db
    .prepare(
      `${SUMMARY_SQL}
        WHERE p.puuid = :puuid AND (:queue IS NULL OR m.queue_id = :queue)
        ORDER BY m.game_creation DESC, m.match_id DESC
        LIMIT :limit OFFSET :offset`
    )
    .all({ account: accountId, accountText: String(accountId), puuid, queue: queueId, limit, offset }) as unknown as SummaryRow[]

  return rows.map(toSummary)
}

export function countTftMatchSummaries(db: DatabaseSync, puuid: string, queueId: number | null = null): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM tft_participants p
         JOIN matches m ON m.match_id = p.match_id
        WHERE p.puuid = ? AND (? IS NULL OR m.queue_id = ?)`
    )
    .get(puuid, queueId, queueId) as unknown as { n: number }
  return Number(row.n)
}

export function getTftMatchSummary(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  matchId: string
): TftMatchSummary | null {
  const row = db
    .prepare(`${SUMMARY_SQL} WHERE p.puuid = :puuid AND m.match_id = :match`)
    .get({ account: accountId, accountText: String(accountId), puuid, match: matchId }) as unknown as SummaryRow | undefined
  return row ? toSummary(row) : null
}

/**
 * Every board in one game, best first, with the player picked out where an
 * account here is them.
 *
 * `accounts` maps a puuid — under whichever key filed the boards — to the
 * account it belongs to.
 */
export function getTftLobby(db: DatabaseSync, matchId: string, accounts: ReadonlyMap<string, number>): TftLobby | null {
  const match = db
    .prepare(
      `SELECT match_id, game_creation, game_duration, queue_id, tft_set_number
         FROM matches WHERE match_id = ? AND game = 'tft'`
    )
    .get(matchId) as unknown as
    | { match_id: string; game_creation: number; game_duration: number; queue_id: number | null; tft_set_number: number | null }
    | undefined
  if (!match) return null

  const rows = db
    .prepare(
      `SELECT puuid, game_name, tag_line, partner_group_id,
              placement, team_placement, level, last_round, time_eliminated,
              players_eliminated, total_damage_to_players, gold_left,
              traits_json, units_json, augments_json
         FROM tft_participants
        WHERE match_id = ?
        ORDER BY placement ASC`
    )
    .all(matchId) as unknown as Array<
    BoardRow & { puuid: string; game_name: string | null; tag_line: string | null; partner_group_id: number | null }
  >

  const participants: TftLobbyParticipant[] = rows.map((row) => {
    const account = accounts.get(row.puuid)
    return {
      puuid: row.puuid,
      gameName: row.game_name,
      tagLine: row.tag_line,
      accountId: account === undefined ? null : String(account),
      partnerGroupId: row.partner_group_id,
      ...boardOf(row)
    }
  })

  return {
    matchId: match.match_id,
    gameCreation: match.game_creation,
    gameDuration: match.game_duration,
    queueId: match.queue_id,
    setNumber: match.tft_set_number,
    participants
  }
}

/** One player's finishes over a window, as the ladder cards count them. */
export function getTftFinishes(
  db: DatabaseSync,
  puuid: string,
  sinceMs: number | null,
  untilMs: number | null
): TftFinish[] {
  const rows = db
    .prepare(
      `SELECT p.placement, p.team_placement, m.queue_id
         FROM tft_participants p
         JOIN matches m ON m.match_id = p.match_id
        WHERE p.puuid = ?
          AND (? IS NULL OR m.game_creation >= ?)
          AND (? IS NULL OR m.game_creation < ?)`
    )
    .all(puuid, sinceMs, sinceMs, untilMs, untilMs) as unknown as Array<{
    placement: number
    team_placement: number | null
    queue_id: number | null
  }>

  return rows.map((row) => ({ placement: row.placement, teamPlacement: row.team_placement, queueId: row.queue_id }))
}

/** A ranked TFT game the LP editor can offer: one attribution left without a figure, or one already typed. */
export interface EditableTftRow {
  matchId: string
  gameCreation: number
  gameDuration: number
  timeEliminated: number
  queueId: number
  placement: number
  teamPlacement: number | null
}

/**
 * The ranked TFT games of one ladder the editor can offer, newest first: those
 * attribution left without a figure, and those the player already entered —
 * the same rule as League's getEditableRankedMatches.
 */
export function getEditableTftRows(
  db: DatabaseSync,
  accountId: number,
  puuid: string,
  queueId: number
): EditableTftRow[] {
  const rows = db
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration, m.queue_id,
              p.time_eliminated, p.placement, p.team_placement
         FROM tft_participants p
         JOIN matches m ON m.match_id = p.match_id
         LEFT JOIN match_rank mr ON mr.match_id = p.match_id AND mr.account_id = ?
        WHERE p.puuid = ?
          AND m.queue_id = ?
          AND (mr.match_id IS NULL OR mr.lp_delta IS NULL
               OR EXISTS (SELECT 1 FROM rank_snapshots rs
                           WHERE rs.match_id = p.match_id
                             AND rs.account_id = mr.account_id
                             AND rs.source = 'manual'))
        ORDER BY m.game_creation DESC`
    )
    .all(accountId, puuid, queueId) as unknown as Array<{
    match_id: string
    game_creation: number
    game_duration: number
    queue_id: number
    time_eliminated: number
    placement: number
    team_placement: number | null
  }>

  return rows.map((row) => ({
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    timeEliminated: row.time_eliminated,
    queueId: row.queue_id,
    placement: row.placement,
    teamPlacement: row.team_placement
  }))
}

/**
 * Moves every board filed under one id onto another, for an identity that
 * changed with a key — payloads first, while the old id still finds them, so a
 * game imported elsewhere later carries the id that works. Not a transaction
 * of its own: the caller's is.
 */
export function rekeyTftBoards(db: DatabaseSync, from: string, to: string): number {
  if (from === to) return 0
  db.prepare(
    `UPDATE matches
        SET raw_json = replace(raw_json, ?, ?)
      WHERE match_id IN (SELECT match_id FROM tft_participants WHERE puuid = ?)`
  ).run(from, to, from)
  return Number(db.prepare('UPDATE OR IGNORE tft_participants SET puuid = ? WHERE puuid = ?').run(to, from).changes)
}
