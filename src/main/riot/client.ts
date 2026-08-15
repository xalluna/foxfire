import { RiotApiError, RiotRateLimiter, PERSONAL_KEY_LIMITS } from './rateLimiter'
import { beginRiotRequest } from '../telemetry/riotRecorder'
import { captureContext, runInContext } from '../telemetry/spans'

export const rateLimiter = new RiotRateLimiter(PERSONAL_KEY_LIMITS)

let currentApiKey: string | null = null

/** Called by keyStore.ts on startup (after decrypting) and whenever the user updates the key in Settings. */
export function setApiKey(key: string | null): void {
  currentApiKey = key
  if (key) rateLimiter.resume()
}

export function hasApiKey(): boolean {
  return currentApiKey !== null
}

/** For endpoints whose response body is ignored, so they still get instrumented. */
export const PASSTHROUGH = { parse: (data: unknown): unknown => data }

/**
 * Every Riot API call in the app. Always goes through the shared rate limiter,
 * and throws RiotApiError on non-2xx so the limiter can decide whether to retry
 * (429/5xx) or surface a key problem (401/403).
 *
 * Validation happens here rather than in the endpoint wrappers so that a
 * changed Riot payload is attributable to the request that carried it. When
 * wrappers parsed their own responses, a schema drift recorded a clean 200 and
 * failed somewhere else entirely.
 *
 * `endpoint` is the path template ('/lol/match/v5/matches/{matchId}'); `path`
 * is the concrete URL. Telemetry stores the first and only a hash of the
 * second, because concrete paths embed PUUIDs and match IDs.
 *
 * Note the parse runs *outside* rateLimiter.schedule: the limiter dispatches
 * serially, so anything inside its closure delays the next request. Validating
 * a 200KB match payload there would add itself to the critical path of every
 * backfill.
 */
export async function riotRequest<T>(
  endpoint: string,
  baseUrl: string,
  path: string,
  schema: { parse: (data: unknown) => T }
): Promise<T> {
  if (!currentApiKey) {
    throw new RiotApiError('No Riot API key configured', 401)
  }

  const recorder = beginRiotRequest(endpoint, baseUrl, path)
  // The limiter runs this closure from its pump loop, outside whatever async
  // context scheduled it, so the span context has to be carried across by hand.
  const spanContext = captureContext()

  let data: unknown
  try {
    data = await rateLimiter.schedule(() =>
      runInContext(spanContext, async () => {
        recorder.attemptStarted()

        let response: Response
        try {
          response = await fetch(`${baseUrl}${path}`, {
            headers: { 'X-Riot-Token': currentApiKey! }
          })
        } catch (err) {
          recorder.attemptFailed('network_error', null, err)
          throw err
        }

        if (response.status === 404) {
          const err = new RiotApiError('Not found', 404)
          recorder.attemptFailed('http_error', response, err)
          throw err
        }

        if (!response.ok) {
          const retryAfterHeader = response.headers.get('Retry-After')
          const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
          const err = new RiotApiError(
            `Riot API error ${response.status} for ${path}`,
            response.status,
            retryAfterMs
          )
          const outcome =
            response.status === 401 || response.status === 403 ? 'key_invalid' : 'http_error'
          recorder.attemptFailed(outcome, response, err)
          throw err
        }

        recorder.attemptSucceeded(response)
        return (await response.json()) as unknown
      })
    )
  } catch (err) {
    // Covers the case where the limiter rejected the job without ever running
    // it — a no-op when an attempt did run and recorded itself.
    recorder.abandoned(err)
    throw err
  }

  try {
    const parsed = schema.parse(data)
    recorder.settle('ok')
    return parsed
  } catch (err) {
    recorder.settle('parse_error', err)
    throw err
  }
}

/** Distinguishes "confirmed not found" from other failures, since callers often treat 404 as a valid empty result. */
export function isNotFound(err: unknown): boolean {
  return err instanceof RiotApiError && err.status === 404
}
