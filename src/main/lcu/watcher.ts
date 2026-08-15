import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { getAccountByRiotId } from '../db/repositories/accounts.repo'
import { getSetting } from '../db/repositories/appSettings.repo'
import { CH } from '../ipc/channels'
import { recordRankSnapshot } from '../services/rankHistoryService'
import { refreshRank } from '../services/accountService'
import { TRACKED_QUEUES } from '@shared/queues'
import type { LcuStatus, QueueType } from '@shared/types'
import { discoverLcu } from './discovery'
import { lcuGet } from './client'

export const LCU_PATH_SETTING = 'lcu.installPath'

/**
 * Polls the running League client for rank.
 *
 * Ten seconds is frequent enough to land a snapshot between two games — the
 * post-game screen alone lasts longer — and it costs nothing: this is loopback
 * traffic, entirely outside Riot's rate limit. A snapshot is only written when
 * the value actually changes, so idling in the client adds no rows.
 *
 * Polling rather than the client's event WebSocket on purpose: it is far less
 * code, and it recovers on its own when the client restarts and changes port,
 * which a long-lived socket would have to detect and reconnect through.
 */
const POLL_CONNECTED_MS = 10_000

/**
 * Detection spawns a PowerShell query, so idling at the connected rate would
 * burn a process every ten seconds for the many hours the app is open without
 * League. Nothing is missed by checking less often: the client takes far longer
 * than this to reach a game.
 */
const POLL_IDLE_MS = 30_000

let timer: NodeJS.Timeout | null = null
let running = false
let status: LcuStatus = { state: 'disconnected' }

interface CurrentSummoner {
  /**
   * The canonical account UUID. Deliberately unused for lookups: Riot's public
   * API hands out a per-key *encrypted* puuid instead, so this never matches
   * anything in the accounts table.
   */
  puuid: string
  gameName: string
  tagLine: string
}

interface RankedQueue {
  queueType: string
  tier: string | null
  division: string | null
  leaguePoints: number | null
  wins: number | null
  losses: number | null
}

interface RankedStats {
  queues: RankedQueue[]
}

export function getLcuStatus(): LcuStatus {
  return status
}

function setStatus(next: LcuStatus): void {
  const changed = JSON.stringify(next) !== JSON.stringify(status)
  status = next
  if (!changed) return
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(CH.lcu.status, next)
  }
}

/**
 * The client uses the literal string "NA" for "not applicable" in both tier and
 * division — an unranked queue reports tier "NA", and the apex tiers report
 * division "NA". Stored verbatim it would read as a real rank named NA, so it
 * is folded to null, which is what the ladder math already treats as unranked.
 */
function normaliseRankField(value: string | null): string | null {
  return !value || value === 'NA' ? null : value
}

async function tick(): Promise<void> {
  const db = getDb()

  const creds = await discoverLcu(getSetting(db, LCU_PATH_SETTING))
  if (!creds) {
    setStatus({ state: 'disconnected' })
    return
  }

  try {
    const summoner = await lcuGet<CurrentSummoner>(creds, '/lol-summoner/v1/current-summoner')

    // Matched on Riot ID, not puuid: the client reports the canonical account
    // UUID while stored accounts carry Riot's per-key encrypted puuid, and the
    // two never compare equal. See getAccountByRiotId.
    const account = getAccountByRiotId(db, summoner.gameName, summoner.tagLine)

    if (!account) {
      // Surfaced as a prompt rather than acted on: adding an account hits Riot
      // and changes what the app tracks, which is the user's call to make.
      setStatus({
        state: 'untracked',
        gameName: summoner.gameName,
        tagLine: summoner.tagLine
      })
      return
    }

    setStatus({
      state: 'connected',
      accountId: account.id,
      gameName: account.gameName,
      tagLine: account.tagLine
    })

    const stats = await lcuGet<RankedStats>(creds, '/lol-ranked/v1/current-ranked-stats')
    let moved = false

    for (const queue of stats.queues ?? []) {
      if (!TRACKED_QUEUES.includes(queue.queueType as QueueType)) continue

      const tier = normaliseRankField(queue.tier)
      // An unranked queue has no ladder position, so a snapshot of it would be
      // an unplottable row saying nothing. Recording starts at placement.
      if (!tier) continue

      const recorded = recordRankSnapshot(
        account.id,
        {
          queueType: queue.queueType as QueueType,
          tier,
          rank: normaliseRankField(queue.division),
          leaguePoints: queue.leaguePoints,
          wins: queue.wins,
          losses: queue.losses
        },
        'lcu'
      )
      moved ||= recorded
    }

    if (moved) {
      // The snapshot is already stored; this refreshes league_entries so the
      // profile card matches, and is skipped when nothing moved so an idle
      // client costs no Riot API budget.
      refreshRank(account.id).catch(() => {})

      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(CH.lcu.rankChanged, account.id)
      }
    }
  } catch {
    // The client can close mid-poll, or refuse requests while it is still
    // starting up. Neither is worth reporting — the next tick retries.
    setStatus({ state: 'disconnected' })
  }
}

/**
 * Self-scheduling rather than setInterval, for two reasons: the delay adapts to
 * whether a client is connected, and a slow tick can never overlap the next one
 * — discovery shells out, so a stalled query would otherwise stack up.
 */
async function loop(): Promise<void> {
  if (!running) return
  await tick()
  if (!running) return
  timer = setTimeout(
    () => void loop(),
    status.state === 'disconnected' ? POLL_IDLE_MS : POLL_CONNECTED_MS
  )
}

export function startLcuWatcher(): void {
  if (running) return
  running = true
  void loop()
}

export function stopLcuWatcher(): void {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
}
