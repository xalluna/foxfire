import { BrowserWindow } from 'electron'
import { getDb } from '../db'
import { getAccountByRiotId } from '../db/repositories/accounts.repo'
import { getSetting } from '../db/repositories/appSettings.repo'
import { CH } from '../ipc/channels'
import { recordRankSnapshot } from '../services/rankHistoryService'
import { refreshRank } from '../services/accountService'
import { schedulePostGameSync } from '../services/postGameSync'
import { onGamePhase } from '../capture/captureService'
import { createLogger } from '../telemetry/logger'
import { recordLcuError, recordLcuPoll, recordLcuTransition } from '../telemetry/lcu'
import { isRankedQueue, TRACKED_QUEUES } from '@shared/queues'
import type { LcuStatus, QueueType } from '@shared/types'
import { discoverLcu, type LcuCredentials } from './discovery'
import { isGameEndTransition, isPlayingPhase } from './gameflow'
import { lcuGet } from './client'

export const LCU_PATH_SETTING = 'lcu.installPath'

const log = createLogger('lcu')

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

/** Previous gameflow phase, so a tick can tell what changed. */
let lastPhase: string | null = null

/**
 * The queue of the game currently being played, captured while it is still in
 * progress.
 *
 * Read during the game rather than at the end because that is the only point
 * the client reliably still has gameData populated — by EndOfGame it may have
 * been torn down. It decides one thing: whether to force a rank snapshot, which
 * is meaningful for a ranked game and noise for an ARAM.
 */
let currentQueueId: number | null = null

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

interface GameflowSession {
  gameData?: { queue?: { id?: number } }
}

export function getLcuStatus(): LcuStatus {
  return status
}

function setStatus(next: LcuStatus): void {
  const changed = JSON.stringify(next) !== JSON.stringify(status)
  status = next
  if (!changed) return
  log.debug('LCU status changed', { state: next.state })
  recordLcuTransition(next.state)
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

/**
 * Follows the gameflow phase and reports whether a game just ended.
 *
 * Also caches the queue while the game runs — see currentQueueId. Failures are
 * swallowed to null rather than thrown: these two endpoints are an enhancement
 * to a poll whose real job is rank, and an older client missing one of them
 * must not take the rank snapshot down with it.
 */
async function trackGameflow(creds: LcuCredentials, accountId: number): Promise<boolean> {
  let phase: string | null = null
  try {
    phase = await lcuGet<string>(creds, '/lol-gameflow/v1/gameflow-phase')
  } catch (err) {
    log.debug('Gameflow phase read failed', { error: String(err) })
    return false
  }

  if (isPlayingPhase(phase)) {
    try {
      const session = await lcuGet<GameflowSession>(creds, '/lol-gameflow/v1/session')
      currentQueueId = session.gameData?.queue?.id ?? null
    } catch (err) {
      log.debug('Gameflow session read failed', { error: String(err) })
    }
  }

  // The only signal capture gets that a game exists at all. Ten seconds is far
  // too coarse to time a recording by, but arming does not need to be quick:
  // the loading screen that follows lasts at least a minute, and the recording
  // itself is started by the game answering on loopback.
  onGamePhase(accountId, currentQueueId, isPlayingPhase(phase))

  const ended = isGameEndTransition(lastPhase, phase)
  // Logged rather than pushed through recordLcuTransition: that helper dedupes
  // against a single lastState shared with the connection state, so feeding
  // phases into it would make every connected/disconnected change look new.
  if (phase !== lastPhase) log.debug('Gameflow phase changed', { from: lastPhase, to: phase })
  lastPhase = phase

  return ended
}

async function tick(): Promise<void> {
  const db = getDb()

  const creds = await discoverLcu(getSetting(db, LCU_PATH_SETTING))
  if (!creds) {
    setStatus({ state: 'disconnected' })
    return
  }

  const pollStartedAt = Date.now()

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

    // Read before the rank stats so the snapshot below can be forced when a
    // ranked game has just concluded.
    const gameEnded = await trackGameflow(creds, account.id)
    const endedRanked = gameEnded && isRankedQueue(currentQueueId)
    if (gameEnded) currentQueueId = null

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
        'lcu',
        Date.now(),
        // A ranked game that moved no LP — a loss at 0 LP with demotion
        // protection — still has to close its interval, or the open one runs on
        // and swallows the next game too, costing both their LP figure.
        endedRanked
      )
      moved ||= recorded
    }

    if (gameEnded) {
      // Every queue, not just ranked: a normal or ARAM game moves no LP but
      // still needs fetching, which is the whole point of the refresh.
      schedulePostGameSync(account.id)
    }

    if (moved) {
      // The snapshot is already stored; this refreshes league_entries so the
      // profile card matches, and is skipped when nothing moved so an idle
      // client costs no Riot API budget.
      refreshRank(account.id).catch((err) => {
        log.debug('Backstop rank refresh failed after LP change', { error: String(err) })
      })

      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(CH.lcu.rankChanged, account.id)
      }
    }

    recordLcuPoll(Date.now() - pollStartedAt)
  } catch (err) {
    // The client can close mid-poll, or refuse requests while it is still
    // starting up. Neither is worth reporting to the user — the next tick
    // retries — but it is worth recording, because this catch is where a real
    // LCU problem would otherwise disappear without trace.
    log.debug('LCU poll failed', { error: String(err) })
    recordLcuError(err)
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
  // Only cleared on a full stop, never on a transient disconnect. A poll that
  // fails mid-game would otherwise forget it was in one, and the end-of-game
  // transition on the next tick — the one moment this exists to catch — would
  // read as a phase appearing out of nowhere and be ignored.
  lastPhase = null
  currentQueueId = null
}
