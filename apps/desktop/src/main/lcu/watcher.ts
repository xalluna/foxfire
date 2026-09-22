import { getDb } from '../db'
import { getSetting } from '../db/repositories/appSettings.repo'
import { CH } from '../ipc/channels'
import { broadcast } from '../ipc/broadcast'
import { lcuReporting } from '../api/lcuReporting'
import { rescanReplays } from '../rofl/watcher'
import { onGamePhase } from '../capture/captureService'
import { setAppIconLcu } from '../appIcon'
import { createLogger } from '../telemetry/logger'
import { recordLcuError, recordLcuPoll, recordLcuTransition } from '../telemetry/lcu'
import { queueTypeForQueueId, TRACKED_QUEUES } from '@foxfire/core'
import type { LcuStatus, QueueType } from '@shared/types'
import { discoverLcu, type LcuCredentials } from './discovery'
import { isGameEndTransition, isPlayingPhase } from './gameflow'
import { isSettled, pendingReadingFor, type PendingRankReading } from './rankSettling'
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

/**
 * Whether the client is in a game right now, for the Live game tab's indicator.
 *
 * Separate from currentQueueId, which is only meaningful for a ranked snapshot
 * and is cleared the moment a game ends. This follows the phase itself.
 */
let inGame = false

/**
 * The ladder a just-finished ranked game was played on, held until its LP
 * reading stops moving. See rankSettling: the client serves the pre-game rank
 * for a few seconds after a game ends, so the reading is given a window to
 * settle before an unchanged one is taken at its word.
 */
let pendingReading: PendingRankReading | null = null

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
  // After the unchanged guard above: the badge only needs touching when the
  // status actually moved.
  setAppIconLcu(next)
  broadcast(CH.lcu.status, next)
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
async function trackGameflow(creds: LcuCredentials, accountId: string): Promise<boolean> {
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
  inGame = isPlayingPhase(phase)
  onGamePhase(accountId, currentQueueId, inGame)

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

    // Through the reporting seam rather than straight to SQLite, because
    // connected to a server the accounts are the server's. Either way the match
    // is on the Riot ID, not the player id: the client reports the canonical
    // account UUID while everything stored carries Riot's per-key encrypted
    // puuid, and the two never compare equal.
    const reporting = lcuReporting()
    const account = await reporting.findAccount(summoner.gameName, summoner.tagLine)

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

    const connected = {
      state: 'connected' as const,
      accountId: account.id,
      gameName: account.gameName,
      tagLine: account.tagLine
    }
    // Reported before the phase is read, so a client that has just appeared is
    // shown as connected without waiting on two more requests.
    setStatus({ ...connected, inGame })

    // Read before the rank stats so the snapshot below can be forced when a
    // ranked game has just concluded.
    const gameEnded = await trackGameflow(creds, account.id)
    // Again with the fresh phase. setStatus ignores an unchanged value, so the
    // repeat costs nothing on the many ticks where nothing moved.
    setStatus({ ...connected, inGame })
    // Read before currentQueueId is cleared, and kept as the queue type rather
    // than a bare "was ranked" flag: only the ladder that was actually played on
    // is waited on, and forcing the other one writes a duplicate row that closes
    // an interval nothing measured.
    const endedQueueType = gameEnded ? queueTypeForQueueId(currentQueueId) : null
    if (gameEnded) currentQueueId = null
    if (endedQueueType) pendingReading = pendingReadingFor(endedQueueType, Date.now())

    const stats = await lcuGet<RankedStats>(creds, '/lol-ranked/v1/current-ranked-stats')
    let moved = false

    for (const queue of stats.queues ?? []) {
      const queueType = queue.queueType as QueueType
      if (!TRACKED_QUEUES.includes(queueType)) continue

      const tier = normaliseRankField(queue.tier)
      // An unranked queue has no ladder position, so a snapshot of it would be
      // an unplottable row saying nothing. Recording starts at placement.
      if (!tier) continue

      const now = Date.now()
      const recorded = await reporting.recordRank(
        account.id,
        {
          queueType,
          tier,
          rank: normaliseRankField(queue.division),
          leaguePoints: queue.leaguePoints,
          wins: queue.wins,
          losses: queue.losses
        },
        // A ranked game that moved no LP — a loss at 0 LP with demotion
        // protection — still has to close its interval, or the open one runs on
        // and swallows the next game too, costing both their LP figure. Only
        // once the reading has had time to settle, though; before that
        // "unchanged" more often means the client has not caught up yet.
        isSettled(pendingReading, queueType, now)
      )

      // Whether the reading moved on its own or was forced once settled, the
      // finished game's interval is now closed and nothing is left to wait for.
      if (recorded && pendingReading?.queueType === queueType) pendingReading = null
      moved ||= recorded
    }

    if (gameEnded) {
      // Every queue, not just ranked: a normal or ARAM game moves no LP but
      // still needs fetching, which is the whole point of the refresh.
      //
      // The waiting is somebody else's job in server mode — match-v5 publishes
      // minutes late, and that ladder has to keep running after this laptop
      // closes — so this is a signal rather than a schedule.
      await reporting.gameEnded(account.id)

      // The client writes the .rofl around now, if the player has replays
      // switched on. The folder watcher will usually see it first; this is the
      // backstop for the case where it did not, and it costs one directory read.
      void rescanReplays()
    }

    if (moved) {
      // The reading is already stored; this brings the profile card's current
      // standing into line with it, and is skipped when nothing moved so an idle
      // client costs no Riot API budget.
      reporting.refreshStanding(account.id).catch((err) => {
        log.debug('Backstop rank refresh failed after LP change', { error: String(err) })
      })

      broadcast(CH.lcu.rankChanged, account.id)
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
  inGame = false
  pendingReading = null
}
