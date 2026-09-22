import type { DatabaseSync } from 'node:sqlite'
import type { ChampionStats, MatchDetail, MatchParticipant, MatchSummary } from '@shared/types'
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
          largest_multi_kill, game_ended_in_early_surrender, role_bound_item)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        p.largestMultiKill ?? null,
        p.gameEndedInEarlySurrender ? 1 : 0,
        p.roleBoundItem ?? 0
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
  role_bound_item: number
  summoner1_id: number | null
  summoner2_id: number | null
  perks_json: string | null
  team_position: string | null
  team_kills: number | null
  team_damage: number | null
  game_ended_in_early_surrender: number
  // All null unless a match_rank row exists for this match and account.
  lp_delta: number | null
  tier_before: string | null
  rank_before: string | null
  tier_after: string | null
  rank_after: string | null
  is_promotion: number | null
  is_demotion: number | null
  has_manual_rank: number
  recording_id: number | null
  replay_id: number | null
}

/**
 * A page of match history for one player.
 *
 * Selects the full per-row stat set rather than the bare minimum: every field
 * is already on disk, so a denser match row costs one query rather than any
 * additional Riot traffic. The subquery folds each team's kills and damage
 * into the row so kill participation and damage share can be shown without a
 * second round trip per match.
 *
 * `queueId` filters here rather than in the renderer so that LIMIT/OFFSET page
 * over the filtered set — paging first and filtering after would yield short,
 * uneven pages. The predicate goes on the outer query, leaving the team-totals
 * subquery whole so kill participation stays correct under any filter.
 */
export function getMatchSummaries(
  db: DatabaseSync,
  puuid: string,
  limit: number,
  offset: number,
  queueId: number | null = null
): MatchSummary[] {
  const rows = db
    .prepare(
      `SELECT m.match_id, m.game_creation, m.game_duration, m.game_mode, m.queue_id,
              p.win, p.champion_id, p.champion_name, p.champ_level,
              p.kills, p.deaths, p.assists, p.cs, p.gold_earned,
              p.damage_dealt_to_champions, p.largest_multi_kill, p.items_json,
              p.role_bound_item, p.summoner1_id, p.summoner2_id, p.perks_json, p.team_position,
              p.game_ended_in_early_surrender,
              t.team_kills, t.team_damage,
              mr.lp_delta, mr.tier_before, mr.rank_before, mr.tier_after, mr.rank_after,
              mr.is_promotion, mr.is_demotion,
              -- Only the row's context menu reads this, to choose between
              -- offering an edit and offering to clear one.
              EXISTS (SELECT 1 FROM rank_snapshots rs
                       WHERE rs.match_id = p.match_id
                         AND rs.source = 'manual'
                         AND rs.account_id = (SELECT id FROM accounts WHERE puuid = p.puuid))
                AS has_manual_rank,
              -- Only the context menu reads this, to decide whether watching
              -- the game is on offer. An ad-hoc search resolves no account, so
              -- the correlated lookup yields NULL and no row claims a recording.
              (SELECT rp.id FROM recordings rp
                WHERE rp.match_id = p.match_id
                  AND rp.account_id = (SELECT id FROM accounts WHERE puuid = p.puuid)
                ORDER BY rp.id DESC LIMIT 1) AS recording_id,
              -- The Riot replay, if one was ingested. Deliberately not scoped
              -- to the account, unlike the recording above: a .rofl is one file
              -- per game on this machine and serves whoever played it, so a game
              -- played on a second account still offers its replay from the
              -- first. Soft-deleted rows are excluded, or a replay the user
              -- removed would go on advertising itself on the match row.
              (SELECT rf.id FROM replays rf
                WHERE rf.match_id = p.match_id
                  AND rf.deleted_at IS NULL
                ORDER BY rf.id DESC LIMIT 1) AS replay_id
         FROM match_participants p
         JOIN matches m ON m.match_id = p.match_id
         JOIN (SELECT match_id, team_id,
                      SUM(kills) AS team_kills,
                      SUM(damage_dealt_to_champions) AS team_damage
                 FROM match_participants
                GROUP BY match_id, team_id) t
           ON t.match_id = p.match_id AND t.team_id = p.team_id
         -- Resolving the account inline keeps this usable for ad-hoc searches:
         -- a puuid with no tracked account yields NULL and the LEFT JOIN simply
         -- produces no LP data, rather than needing a separate code path.
         LEFT JOIN match_rank mr
           ON mr.match_id = p.match_id
          AND mr.account_id = (SELECT id FROM accounts WHERE puuid = p.puuid)
        WHERE p.puuid = ?
          AND (? IS NULL OR m.queue_id = ?)
        ORDER BY m.game_creation DESC
        LIMIT ? OFFSET ?`
    )
    .all(puuid, queueId, queueId, limit, offset) as unknown as MatchSummaryRow[]

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
    roleBoundItem: row.role_bound_item,
    summoner1Id: row.summoner1_id,
    summoner2Id: row.summoner2_id,
    perks: row.perks_json ? JSON.parse(row.perks_json) : null,
    teamPosition: row.team_position,
    teamKills: row.team_kills ?? 0,
    teamDamage: row.team_damage ?? 0,
    isRemake: row.game_ended_in_early_surrender === 1,
    rank:
      row.is_promotion === null
        ? null
        : {
            lpDelta: row.lp_delta,
            tierBefore: row.tier_before,
            rankBefore: row.rank_before,
            tierAfter: row.tier_after,
            rankAfter: row.rank_after,
            isPromotion: row.is_promotion === 1,
            isDemotion: row.is_demotion === 1
          },
    hasManualRank: row.has_manual_rank === 1,
    local: { recordingId: row.recording_id, replayId: row.replay_id }
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
  role_bound_item: number
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
    roleBoundItem: row.role_bound_item,
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

/**
 * Per-champion performance computed locally from stored matches — no API call needed.
 *
 * Joins `matches` for `queue_id`, which lives there rather than on
 * `match_participants`. Without the join this aggregate mixes ARAM and Normals
 * into the same win rate as Ranked Solo, which is exactly what makes unfiltered
 * champion stats untrustworthy. The same join supplies `game_duration`, the
 * denominator for every per-minute rate.
 *
 * Remakes are excluded: a game voided after two minutes is not evidence about
 * how a champion performs, and counting them is what made these numbers differ
 * from op.gg's.
 *
 * `sinceMs`/`untilMs` scope the aggregate to a ranked year. Unbounded, this
 * blends every year of games into one win rate with no way to tell them apart —
 * a champion abandoned two seasons ago still drags on the number. The bounds
 * arrive as epoch milliseconds rather than as a year, because game_creation is
 * epoch ms and a SQL year expression would resolve in UTC while the app decides
 * periods in local time. See shared/seasons.ts.
 *
 * Two different averages are returned on purpose:
 *
 * - Totals (kills, cs, damage, duration) are pooled, so the caller's derived
 *   ratios agree with the per-game averages printed beside them. A KDA of
 *   totalK+A over totalD is the same arithmetic the reader can do from the
 *   averages on screen; a mean of per-game ratios is not, and looks like a bug.
 * - Shares are meaned per game, because they are already normalised. Pooling
 *   them would let one forty-minute game outvote three short ones for a number
 *   that is supposed to describe a typical game.
 */
export function getChampionStats(
  db: DatabaseSync,
  puuid: string,
  queueId: number | null = null,
  sinceMs: number | null = null,
  untilMs: number | null = null
): ChampionStats[] {
  const rows = db
    .prepare(
      // The team-totals subquery is the same one getMatchSummaries uses, and for
      // the same reason: it stays unfiltered so the denominator is the whole
      // team, while the queue predicate sits on the outer query.
      //
      // CAST(... AS REAL) is load-bearing. SQLite integer-divides two INTEGER
      // columns, so 18900 / 84000 floors to 0 and every share reads 0%.
      //
      // The CASE has no ELSE, so a shut-out team yields NULL and AVG skips it —
      // the game drops out of the mean rather than dragging it toward zero.
      // Every game shut out leaves the whole average NULL, matching how
      // damageShare/killParticipation report "no data" for a single match.
      `SELECT p.champion_id,
              COUNT(*)                                      AS games,
              SUM(p.win)                                    AS wins,
              SUM(p.kills)                                  AS kills,
              SUM(p.deaths)                                 AS deaths,
              SUM(p.assists)                                AS assists,
              COALESCE(SUM(p.cs), 0)                        AS cs,
              COALESCE(SUM(p.damage_dealt_to_champions), 0) AS damage,
              COALESCE(SUM(m.game_duration), 0)             AS duration_seconds,
              AVG(CASE WHEN t.team_damage > 0
                       THEN CAST(p.damage_dealt_to_champions AS REAL) / t.team_damage END)
                                                            AS damage_share,
              AVG(CASE WHEN t.team_kills > 0
                       THEN CAST(p.kills + p.assists AS REAL) / t.team_kills END)
                                                            AS kill_participation
         FROM match_participants p
         JOIN matches m ON m.match_id = p.match_id
         JOIN (SELECT match_id, team_id,
                      SUM(kills) AS team_kills,
                      SUM(damage_dealt_to_champions) AS team_damage
                 FROM match_participants
                GROUP BY match_id, team_id) t
           ON t.match_id = p.match_id AND t.team_id = p.team_id
        WHERE p.puuid = ?
          AND p.game_ended_in_early_surrender = 0
          AND (? IS NULL OR m.queue_id = ?)
          AND (? IS NULL OR m.game_creation >= ?)
          AND (? IS NULL OR m.game_creation < ?)
        GROUP BY p.champion_id
        ORDER BY games DESC`
    )
    .all(puuid, queueId, queueId, sinceMs, sinceMs, untilMs, untilMs) as unknown as Array<{
    champion_id: number
    games: number
    wins: number
    kills: number
    deaths: number
    assists: number
    cs: number
    damage: number
    duration_seconds: number
    damage_share: number | null
    kill_participation: number | null
  }>

  return rows.map((row) => ({
    championId: row.champion_id,
    games: row.games,
    wins: row.wins,
    kills: row.kills,
    deaths: row.deaths,
    assists: row.assists,
    cs: row.cs,
    damageToChampions: row.damage,
    durationSeconds: row.duration_seconds,
    damageShare: row.damage_share,
    killParticipation: row.kill_participation
  }))
}

export function countStoredMatches(db: DatabaseSync, puuid: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM match_participants WHERE puuid = ?')
    .get(puuid) as unknown as { n: number }
  return row.n
}
