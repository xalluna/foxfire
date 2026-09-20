import { ladderPosition, rankMovement } from '@shared/ladder'
import { queueIdForQueueType } from '@shared/queues'
import type {
  EditableMatch,
  ManualRank,
  ManualRankEdit,
  MatchSummary,
  QueueType,
  RankSnapshot
} from '@shared/types'
import { MATCHES, RANK_SNAPSHOTS } from './fixtures'
import { devSeasonIdAt } from './seasons'

/**
 * A working LP editor for the browser harness.
 *
 * Reimplements what the main process does — write a snapshot, then re-derive
 * every LP figure from the snapshot series — rather than stubbing it out, so
 * `npm run dev:web` can be used to build and check the editor end to end with
 * no Riot key, no League client and no synced database. The rule it applies is
 * the one in rankAttribution.ts: a game's LP is known only when exactly one
 * ranked game sits between two consecutive readings.
 *
 * The fixtures are mutated in place. That is fine here and nowhere else: this
 * module is dynamically imported only when window.api is missing, so it never
 * reaches the packaged app.
 */

/** The observed readings, kept aside so a rebuild can start from them again. */
const observed = new Map<string, RankSnapshot[]>()

interface Entry {
  after: ManualRank
  /** Only set for a game with no usable reading before it. */
  before?: ManualRank | null
}

const entries = new Map<string, Map<string, Entry>>()

function key(accountId: string, queueType: QueueType): string {
  return `${accountId}:${queueType}`
}

/**
 * Entries survive a reload.
 *
 * The real editor opens in its own window, so the match list stays live behind
 * it. In a browser there is only one page, and openEditor navigates it — so
 * without this, going back to the dashboard to look at the LP chip you just
 * entered would be the very thing that discarded it, and the round trip the
 * harness exists to demonstrate could never be seen.
 */
const STORAGE_KEY = 'dev:manualRank'

function persist(): void {
  const flat = [...entries].map(([id, byMatch]) => [id, [...byMatch]] as const)
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(flat))
}

function restore(): void {
  const raw = sessionStorage.getItem(STORAGE_KEY)
  if (!raw) return

  try {
    const flat = JSON.parse(raw) as Array<[string, Array<[string, Entry]>]>
    for (const [id, byMatch] of flat) entries.set(id, new Map(byMatch))
  } catch {
    sessionStorage.removeItem(STORAGE_KEY)
    return
  }

  for (const id of entries.keys()) {
    const [accountId, queueType] = id.split(':')
    rebuild(accountId, queueType as QueueType)
  }
}

function baseSnapshots(accountId: string, queueType: QueueType): RankSnapshot[] {
  const id = key(accountId, queueType)
  if (!observed.has(id)) {
    observed.set(id, [...(RANK_SNAPSHOTS[accountId]?.[queueType] ?? [])])
  }
  return observed.get(id)!
}

function entriesFor(accountId: string, queueType: QueueType): Map<string, Entry> {
  const id = key(accountId, queueType)
  if (!entries.has(id)) entries.set(id, new Map())
  return entries.get(id)!
}

/**
 * Ranked, non-remake games on one ladder, oldest first.
 *
 * Chronological because the rebuild walks intervals in time order. The editor
 * is served the reverse — see editableMatches.
 */
function ladderMatches(accountId: string, queueType: QueueType): MatchSummary[] {
  const queueId = queueIdForQueueType(queueType)
  return (MATCHES[accountId] ?? [])
    .filter((m) => m.queueId === queueId && !m.isRemake)
    .sort((a, b) => a.gameCreation - b.gameCreation)
}

function endOf(match: MatchSummary): number {
  return match.gameCreation + match.gameDuration * 1000
}

function toSnapshot(queueType: QueueType, rank: ManualRank, capturedAt: number): RankSnapshot {
  return {
    queueType,
    tier: rank.tier,
    rank: rank.rank,
    leaguePoints: rank.leaguePoints,
    wins: null,
    losses: null,
    ladderPosition: ladderPosition(rank),
    source: 'manual',
    capturedAt,
    seasonId: devSeasonIdAt(capturedAt)
  }
}

/**
 * Re-derives the whole ladder: snapshot series first, then every LP figure from
 * it. Runs after any edit, which is why saving two games of a run of three can
 * hand back a third that resolved on its own.
 */
function rebuild(accountId: string, queueType: QueueType): void {
  const matches = ladderMatches(accountId, queueType)
  const byId = new Map(matches.map((m) => [m.matchId, m]))
  const entered = entriesFor(accountId, queueType)

  const manual: RankSnapshot[] = []
  for (const [matchId, entry] of entered) {
    const match = byId.get(matchId)
    if (!match) continue
    if (entry.before) {
      manual.push(toSnapshot(queueType, entry.before, match.gameCreation - 1))
    }
    manual.push(toSnapshot(queueType, entry.after, endOf(match)))
  }

  const snapshots = [...baseSnapshots(accountId, queueType), ...manual].sort(
    (a, b) => a.capturedAt - b.capturedAt
  )
  RANK_SNAPSHOTS[accountId] = { ...RANK_SNAPSHOTS[accountId], [queueType]: snapshots } as Record<
    QueueType,
    RankSnapshot[]
  >

  for (const match of matches) {
    match.rank = null
    match.hasManualRank = entered.has(match.matchId)
  }

  for (let i = 1; i < snapshots.length; i++) {
    const before = snapshots[i - 1]
    const after = snapshots[i]
    if (before.ladderPosition === null || after.ladderPosition === null) continue

    const between = matches.filter(
      (m) => m.gameCreation > before.capturedAt && m.gameCreation <= after.capturedAt
    )
    if (between.length !== 1) continue

    const movement = rankMovement(before, after)
    between[0].rank = {
      lpDelta: after.ladderPosition - before.ladderPosition,
      tierBefore: before.tier,
      rankBefore: before.rank,
      tierAfter: after.tier,
      rankAfter: after.rank,
      isPromotion: movement === 'promotion',
      isDemotion: movement === 'demotion'
    }
  }
}

export function editableMatches(accountId: string, queueType: QueueType): EditableMatch[] {
  const snapshots = RANK_SNAPSHOTS[accountId]?.[queueType] ?? []
  const entered = entriesFor(accountId, queueType)

  return ladderMatches(accountId, queueType)
    // A game the user entered stays listed even though it now has a figure, so
    // a typo can be corrected without clearing the entry first.
    .filter((match) => match.rank?.lpDelta == null || entered.has(match.matchId))
    .map((match) => {
      const entry = entered.get(match.matchId)
      // Manual readings count: after entering the rank following one game, that
      // is exactly what the next game starts from.
      const previous = [...snapshots].reverse().find((s) => s.capturedAt < match.gameCreation)

      return {
        matchId: match.matchId,
        gameCreation: match.gameCreation,
        gameDuration: match.gameDuration,
        win: match.win,
        championId: match.championId,
        championName: match.championName,
        kills: match.kills,
        deaths: match.deaths,
        assists: match.assists,
        before:
          entry?.before ??
          (previous?.tier
            ? {
                tier: previous.tier,
                rank: previous.rank,
                leaguePoints: previous.leaguePoints ?? 0
              }
            : null),
        beforeAt: previous?.capturedAt ?? null,
        beforeUsable: previous !== undefined && previous.ladderPosition !== null,
        manual: entry?.after ?? null
      }
    })
    // Newest first, matching the ORDER BY in getEditableRankedMatches.
    .reverse()
}

export function saveManualRanks(
  accountId: string,
  queueType: QueueType,
  edits: ManualRankEdit[]
): EditableMatch[] {
  const entered = entriesFor(accountId, queueType)
  for (const edit of edits) {
    entered.set(edit.matchId, { after: edit.after, before: edit.before })
  }
  rebuild(accountId, queueType)
  persist()
  return editableMatches(accountId, queueType)
}

export function clearManualRank(
  accountId: string,
  queueType: QueueType,
  matchId: string
): EditableMatch[] {
  entriesFor(accountId, queueType).delete(matchId)
  rebuild(accountId, queueType)
  persist()
  return editableMatches(accountId, queueType)
}

restore()
