import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { isTelemetryEnabled, recordSpan } from './index'
import { describeError, redactJson } from './redact'

/**
 * Traced operations, propagated with AsyncLocalStorage.
 *
 * ALS is used rather than an explicit context parameter because the alternative
 * is viral: threading a ctx argument through syncService → endpoint wrapper →
 * riotFetch → schedule() would change the signature of every function on the
 * Riot path, and any new caller would have to remember to pass it.
 *
 * The subtlety worth knowing about is the rate limiter's queue. A request
 * scheduled inside a span does not run inside that span's async context — it
 * runs later, from the limiter's pump loop, which is an entirely different
 * continuation. So the context is captured at schedule time and re-entered
 * around the closure body (see riot/client.ts). Without that, every request
 * issued by a sync run would look like an orphan.
 */

export interface SpanContext {
  traceId: string
  spanId: string
}

const storage = new AsyncLocalStorage<SpanContext>()

export function activeSpanId(): string | null {
  return storage.getStore()?.spanId ?? null
}

/** Snapshot of the current context, to be re-entered across a queue boundary. */
export function captureContext(): SpanContext | undefined {
  return storage.getStore()
}

export function runInContext<T>(context: SpanContext | undefined, fn: () => T): T {
  return context ? storage.run(context, fn) : fn()
}

/**
 * Runs `fn` as a span. Nested calls become children automatically.
 *
 * Rows are inserted once, on close, rather than opened and later updated —
 * one write instead of two on a measured path. The cost is that a span
 * interrupted by a crash is never recorded at all, which is the right trade
 * for a developer tool: an incomplete trace is less useful than the log line
 * that will be sitting next to it anyway.
 */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown> | null,
  fn: () => Promise<T>
): Promise<T> {
  if (!isTelemetryEnabled()) return fn()

  const parent = storage.getStore()
  const context: SpanContext = {
    traceId: parent?.traceId ?? randomUUID(),
    spanId: randomUUID()
  }
  const startedAt = Date.now()

  return storage.run(context, async () => {
    let status = 'ok'
    let errorMessage: string | null = null
    try {
      return await fn()
    } catch (err) {
      status = 'error'
      errorMessage = describeError(err).message
      throw err
    } finally {
      const endedAt = Date.now()
      recordSpan({
        spanId: context.spanId,
        traceId: context.traceId,
        parentId: parent?.spanId ?? null,
        name,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        status,
        errorMessage,
        attrsJson: attrs ? redactJson(attrs) : null
      })
    }
  })
}
