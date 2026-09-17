import { randomUUID } from 'node:crypto'
import { isTelemetryEnabled, recordRiotRequest } from './index'
import { describeError, hashId, scrubString } from './redact'
import { activeSpanId } from './spans'
import type { RiotOutcome, RiotRequestRow } from './types'

/**
 * Per-request instrumentation for the Riot client.
 *
 * Split out of riot/client.ts so the fetch flow there still reads as a fetch
 * flow, and so this can be exercised without a network or a live limiter.
 *
 * Two structural facts about the limiter shape everything here:
 *
 *   1. It retries by re-running the same closure, so one logical request can
 *      run several times. Each run is an attempt row; they share a request_id.
 *   2. Requests wait in a FIFO queue before running. Timestamping when
 *      schedule() is called and again when the closure body begins separates
 *      "my own limiter made this wait" from "Riot was slow" — the single most
 *      useful distinction in the whole dataset, and it needs no change to the
 *      limiter itself.
 */

export interface RiotRequestRecorder {
  /** Marks the beginning of an attempt — the closure body has started running. */
  attemptStarted(): void
  attemptFailed(outcome: RiotOutcome, response: Response | null, err: unknown): void
  /** HTTP succeeded; the row is held back until validation settles it. */
  attemptSucceeded(response: Response): void
  /** schedule() rejected. Records a row only if no attempt ever ran. */
  abandoned(err: unknown): void
  /** Closes out a successful attempt once the response body has been validated. */
  settle(outcome: 'ok' | 'parse_error', err?: unknown): void
}

const NOOP: RiotRequestRecorder = {
  attemptStarted() {},
  attemptFailed() {},
  attemptSucceeded() {},
  abandoned() {},
  settle() {}
}

export function beginRiotRequest(
  endpoint: string,
  baseUrl: string,
  path: string
): RiotRequestRecorder {
  if (!isTelemetryEnabled()) return NOOP
  return new ActiveRecorder(endpoint, baseUrl, path)
}

class ActiveRecorder implements RiotRequestRecorder {
  private readonly requestId = randomUUID()
  private readonly spanId = activeSpanId()
  private readonly pathHash: string
  private readonly scheduledAt = Date.now()

  private attempt = 0
  private startedAt = 0
  /**
   * When the previous attempt finished. Makes wait_ms on a retry mean "time
   * lost to backoff before trying again" rather than "time since the caller
   * first asked", which would grow misleadingly across attempts.
   */
  private lastEndedAt = this.scheduledAt
  /** A successful HTTP attempt, held until validation decides ok vs parse_error. */
  private pending: RiotRequestRow | null = null

  constructor(
    private readonly endpoint: string,
    private readonly host: string,
    private readonly path: string
  ) {
    this.pathHash = hashId(path)
  }

  attemptStarted(): void {
    this.attempt += 1
    this.startedAt = Date.now()
  }

  attemptFailed(outcome: RiotOutcome, response: Response | null, err: unknown): void {
    const row = this.buildRow(outcome, response)
    const described = describeError(err)
    row.errorKind = described.kind
    row.errorMessage = this.sanitiseMessage(described.message)
    recordRiotRequest(row)
  }

  attemptSucceeded(response: Response): void {
    this.pending = this.buildRow('ok', response)
  }

  abandoned(err: unknown): void {
    // An attempt that ran has already recorded its own row; this only covers
    // jobs the limiter failed without ever running them, which is what happens
    // to the whole queue when the key expires mid-backfill.
    if (this.attempt > 0) return
    const now = Date.now()
    const described = describeError(err)
    recordRiotRequest({
      requestId: this.requestId,
      spanId: this.spanId,
      attempt: 1,
      endpoint: this.endpoint,
      pathHash: this.pathHash,
      host: this.host,
      scheduledAt: this.scheduledAt,
      startedAt: now,
      endedAt: now,
      waitMs: now - this.scheduledAt,
      networkMs: 0,
      status: null,
      outcome: 'never_ran',
      bytes: null,
      errorKind: described.kind,
      errorMessage: this.sanitiseMessage(described.message),
      appLimit: null,
      appLimitCount: null,
      methodLimit: null,
      methodLimitCount: null,
      retryAfterMs: null
    })
  }

  settle(outcome: 'ok' | 'parse_error', err?: unknown): void {
    const row = this.pending
    if (!row) return
    this.pending = null
    row.outcome = outcome
    if (outcome === 'parse_error') {
      const described = describeError(err)
      row.errorKind = described.kind
      row.errorMessage = this.sanitiseMessage(described.message)
    }
    recordRiotRequest(row)
  }

  private buildRow(outcome: RiotOutcome, response: Response | null): RiotRequestRow {
    const endedAt = Date.now()
    const waitMs = Math.max(0, this.startedAt - this.lastEndedAt)
    this.lastEndedAt = endedAt

    const headers = response?.headers
    return {
      requestId: this.requestId,
      spanId: this.spanId,
      attempt: this.attempt,
      endpoint: this.endpoint,
      pathHash: this.pathHash,
      host: this.host,
      scheduledAt: this.scheduledAt,
      startedAt: this.startedAt,
      endedAt,
      waitMs,
      networkMs: Math.max(0, endedAt - this.startedAt),
      status: response?.status ?? null,
      outcome,
      // Wire bytes from Content-Length rather than measuring the decoded body:
      // reading the body as text to size it would copy up to 200KB per match on
      // the very path being measured.
      bytes: numberHeader(headers, 'content-length'),
      errorKind: null,
      errorMessage: null,
      appLimit: headers?.get('x-app-rate-limit') ?? null,
      appLimitCount: headers?.get('x-app-rate-limit-count') ?? null,
      methodLimit: headers?.get('x-method-rate-limit') ?? null,
      methodLimitCount: headers?.get('x-method-rate-limit-count') ?? null,
      retryAfterMs: retryAfterMs(headers)
    }
  }

  /**
   * Riot error messages embed the concrete path, which carries the PUUID or
   * match ID the rest of this module works to keep off disk. Swapping it for
   * the template preserves everything useful about the message.
   */
  private sanitiseMessage(message: string): string {
    return scrubString(message.split(this.path).join(this.endpoint))
  }
}

function numberHeader(headers: Headers | undefined, name: string): number | null {
  const raw = headers?.get(name)
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function retryAfterMs(headers: Headers | undefined): number | null {
  const seconds = numberHeader(headers, 'retry-after')
  return seconds === null ? null : seconds * 1_000
}
