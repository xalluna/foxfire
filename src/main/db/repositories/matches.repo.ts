import type { DatabaseSync } from 'node:sqlite'
import type { MatchDetail, MatchParticipant, MatchSummary, WinRateEntry } from '@shared/types'
import type { MatchDto } from '../../riot/types'

/** Persists a match and all 10 participants atomically. Idempotent — re-storing a known match is a no-op. */
export function insertMatch(db: DatabaseSync, match: MatchDto): void {
  const { metadata, info } = match

  db.exec('BEGIN')
  try {
    db.prepare(
      `INSERT OR IGNORE INTO matches
         (match_id, game_creation, game_duration, game_mode, game_type, queue_id, platform_id, raw_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      metadata.matchId,
      info.gameCreation,
      info.gameDuration,
      info.gameMode,
      info.gameType,
      info.queueId,
      info.platformId,
      JSON.stringify(match)
    )

    const participantStmt = db.prepare(
      `INSERT OR IGNORE INTO match_participants
         (match_id, puuid, game_name, tag_line, team_id, win, champion_id, champion_name,
          champ_level, kills, deaths, assists, gold_earned, cs, damage_dealt_to_champions,
          damage_taken, items_json, summoner1_id, summoner2_id, perks_json, team_position,
          largest_multi_kill)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    for (const p of info.participants) {
      participantStmt.run(
        metadata.matchId,
        p.puuid,
        p.riotIdGameName ?? null,
        p.riotIdTagline ?? null,
        p.teamId,
        p.win ? 1 : 0,
        p.championId,
        p.championName,
        p.champLevel,
        p.kills,
        p.deaths,
        p.assists,
        p.goldEarned,
        p.totalMinionsKilled + p.neutralMinionsKilled,
        p.totalDamageDealtToChampions,
        p.totalDamageTaken,
        JSON.stringify([p.item0, p.item1, p.item2, p.item3, p.item4, p.item5, p.item6]),
        p.summoner1Id,
        p.summoner2Id,
        JSON.stringify(p.perks),
        p.teamPosition ?? null,
        p.largestMultiKill ?? null
      )
    }

    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function hasMatch(db: DatabaseSync, matchId: string): boolean {
  const row = db.prepare('SELECT 1 AS x FROM matches WHERE match_id = ?').get(matchId)
  return row !== undefined
}

export function filterUnstoredMatchIds(db: DatabaseSync, matchIds: string[]): string[] {
  return matchIds.filter((id) => !hasMatch(db, id))
}

interface MatchSummaryRow {
  match_id: string
  game_creation: number
  game_duration: number
  game_mode: string | null
  queue_id: number | null
  win: number
  champion_id: number
  champion_name: string | null
  champ_level: number | null
  kills: number
  deaths: number
  assists: number
  cs: number | null
  gold_earned: number | null
  damage_dealt_to_champions: number | null
  largest_multi_kill: number | null
  items_json: string | null
  summoner1_id: number | null
  summoner2_id: number | null
  perks_json: string | null
  team_position: string | null
  team_kills: number | null
  team_damage: number | null
}

/**
 * A page of match history for one player.
 *
 * Selects the full per-row stat set rather than the bare minimum: every field
 * is already on disk, so a denser match row costs one query rather than any
 * additional Riot traffic. The subquery folds each team's kills and damage
 * into the row so kill participation and damage share can be shown without a
 * second round trip per match.
 */
export function getMatchSummaries(
  db: DatabaseSync,
  puuid: string,
  limit: number,
  offset: number
): MatchSummary[] {
  const rows = db
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration, m.game_mode, m.queue_id,
              p.win, p.champion_id, p.champion_name, p.champ_level,
              p.kills, p.deaths, p.assists, p.cs, p.gold_earned,
              p.damage_dealt_to_champions, p.largest_multi_kill, p.items_json,
              p.summoner1_id, p.summoner2_id, p.perks_json, p.team_position,
              t.team_kills, t.team_damage
         FROM match_participants p
         JOIN matches m ON m.match_id = p.match_id
         JOIN (SELECT match_id, team_id,
                      SUM(kills) AS team_kills,
                      SUM(damage_dealt_to_champions) AS team_damage
                 FROM match_participants
                GROUP BY match_id, team_id) t
           ON t.match_id = p.match_id AND t.team_id = p.team_id
        WHERE p.puuid = ?
        ORDER BY m.game_creation DESC
        LIMIT ? OFFSET ?`
    )
    .all(puuid, limit, offset) as unknown as MatchSummaryRow[]

  return rows.map((row) => ({
    matchId: row.match_id,
    gameCreation: row.game_creation,
    gameDuration: row.game_duration,
    gameMode: row.game_mode,
    queueId: row.queue_id,
    win: row.win === 1,
    championId: row.champion_id,
    championName: row.champion_name,
    champLevel: row.champ_level,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    cs: row.cs,
    goldEarned: row.gold_earned,
    damageDealtToChampions: row.damage_dealt_to_champions,
    largestMultiKill: row.largest_multi_kill,
    items: row.items_json ? (JSON.parse(row.items_json) as number[]) : [],
    summoner1Id: row.summoner1_id,
    summoner2Id: row.summoner2_id,
    perks: row.perks_json ? JSON.parse(row.perks_json) : null,
    teamPosition: row.team_position,
    teamKills: row.team_kills ?? 0,
    teamDamage: row.team_damage ?? 0
  }))
}

interface ParticipantRow {
  puuid: string
  game_name: string | null
  tag_line: string | null
  team_id: number
  win: number
  champion_id: number
  champion_name: string | null
  champ_level: number | null
  kills: number
  deaths: number
  assists: number
  gold_earned: number | null
  cs: number | null
  damage_dealt_to_champions: number | null
  damage_taken: number | null
  items_json: string | null
  summoner1_id: number | null
  summoner2_id: number | null
  perks_json: string | null
  team_position: string | null
  largest_multi_kill: number | null
}

interface MatchRow {
  match_id: string
  game_creation: number
  game_duration: number
  game_mode: string | null
  game_type: string | null
  queue_id: number | null
}

function toParticipant(row: ParticipantRow): MatchParticipant {
  return {
    puuid: row.puuid,
    gameName: row.game_name,
    tagLine: row.tag_line,
    teamId: row.team_id,
    win: row.win === 1,
    championId: row.champion_id,
    championName: row.champion_name,
    champLevel: row.champ_level,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    goldEarned: row.gold_earned,
    cs: row.cs,
    damageDealtToChampions: row.damage_dealt_to_champions,
    damageTaken: row.damage_taken,
    items: row.items_json ? (JSON.parse(row.items_json) as number[]) : [],
    summoner1Id: row.summoner1_id,
    summoner2Id: row.summoner2_id,
    perks: row.perks_json ? JSON.parse(row.perks_json) : null,
    teamPosition: row.team_position,
    largestMultiKill: row.largest_multi_kill
  }
}

export function getMatchDetail(db: DatabaseSync, matchId: string): MatchDetail | null {
  const match = db
    .prepare('SELECT match_id, game_creation, game_duration, game_mode, game_type, queue_id FROM matches WHERE match_id = ?')
    .get(matchId) as unknown as MatchRow | undefined
  if (!match) return null

  const participants = db
    .prepare('SELECT * FROM match_participants WHERE match_id = ? ORDER BY team_id, id')
    .all(matchId) as unknown as ParticipantRow[]

  return {
    matchId: match.match_id,
    gameCreation: match.game_creation,
    gameDuration: match.game_duration,
    gameMode: match.game_mode,
    gameType: match.game_type,
    queueId: match.queue_id,
    participants: participants.map(toParticipant)
  }
}

/** Per-champion win rate computed locally from stored matches — no API call needed. */
export function getChampionWinRates(db: DatabaseSync, puuid: string): WinRateEntry[] {
  const rows = db
    .prepare(
      `SELECT champion_id, COUNT(*) AS games, SUM(win) AS wins
         FROM match_participants
        WHERE puuid = ?
        GROUP BY champion_id
        ORDER BY games DESC`
    )
    .all(puuid) as unknown as Array<{ champion_id: number; games: number; wins: number }>

  return rows.map((row) => ({
    championId: row.champion_id,
    games: row.games,
    wins: row.wins
  }))
}

export function countStoredMatches(db: DatabaseSync, puuid: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM match_participants WHERE puuid = ?')
    .get(puuid) as unknown as { n: number }
  return row.n
}
