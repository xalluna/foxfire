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
 * Reads a 400 body far enough to tell "this puuid was encrypted under a key you
 * no longer hold" from every other bad request. Riot says `Exception decrypting
 * <puuid>`.
 *
 * The body is deliberately *classified and dropped*, never returned or stored:
 * the message it carries embeds the puuid, and redact.ts scrubs API keys rather
 * than identifiers. A boolean is the whole of what the app needs.
 *
 * Its own try/catch because a body that cannot be read is not a reason to
 * replace the caller's HTTP error with a parse one — the 400 is the finding,
 * this only labels it.
 */
async function isDecryptFailure(response: Response): Promise<boolean> {
  try {
    return /decrypt/i.test(await response.text())
  } catch {
    return false
  }
}

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
            retryAfterMs,
            response.status === 400 && (await isDecryptFailure(response))
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

/**
 * "The puuid you sent was encrypted under a key you no longer hold" — the one
 * failure the app can fix without the user, by re-resolving the account from
 * its Riot ID. See services/identityService.ts.
 */
export function isStaleIdentity(err: unknown): boolean {
  return err instanceof RiotApiError && err.staleIdentity
}
