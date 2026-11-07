import type { RiotKeyScope } from '@foxfire/core'
import { RiotApiError, RiotRateLimiter, PERSONAL_KEY_LIMITS } from './rateLimiter'
import { beginRiotRequest } from '../telemetry/riotRecorder'
import { captureContext, runInContext } from '../telemetry/spans'

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

type Schema<T> = { parse: (data: unknown) => T }

/**
 * One Riot API key: its value, and the limiter its budget is spent through.
 *
 * Riot's limits are per key, so each key gets a queue of its own. The main key
 * is League's and everything else's; a TFT key, when somebody adds one, is
 * TFT's alone. Without one, TFT asks through the main key's scope — see
 * tftRequest.
 */
export interface RiotScope {
  readonly name: RiotKeyScope
  readonly limiter: RiotRateLimiter
  setKey(key: string | null): void
  hasKey(): boolean
  /**
   * One call through this key. `forbiddenMeansNoAccess` reads a 403 as "this
   * key cannot reach this product" rather than as a refused key, which is what
   * a 403 from TFT on a key registered for League alone means.
   */
  request<T>(
    endpoint: string,
    baseUrl: string,
    path: string,
    schema: Schema<T>,
    options?: { forbiddenMeansNoAccess?: boolean }
  ): Promise<T>
}

function createRiotScope(name: RiotKeyScope): RiotScope {
  const limiter = new RiotRateLimiter(PERSONAL_KEY_LIMITS)
  let apiKey: string | null = null

  return {
    name,
    limiter,

    setKey(key) {
      apiKey = key
      if (key) limiter.resume()
    },

    hasKey: () => apiKey !== null,

    /**
     * Every Riot API call in the app. Always goes through the key's rate
     * limiter, and throws RiotApiError on non-2xx so the limiter can decide
     * whether to retry (429/5xx) or surface a key problem (401/403).
     *
     * Validation happens here rather than in the endpoint wrappers so that a
     * changed Riot payload is attributable to the request that carried it. When
     * wrappers parsed their own responses, a schema drift recorded a clean 200
     * and failed somewhere else entirely.
     *
     * `endpoint` is the path template ('/lol/match/v5/matches/{matchId}');
     * `path` is the concrete URL. Telemetry stores the first and only a hash of
     * the second, because concrete paths embed PUUIDs and match IDs.
     *
     * Note the parse runs *outside* limiter.schedule: the limiter dispatches
     * serially, so anything inside its closure delays the next request.
     * Validating a 200KB match payload there would add itself to the critical
     * path of every backfill.
     */
    async request<T>(
      endpoint: string,
      baseUrl: string,
      path: string,
      schema: Schema<T>,
      options: { forbiddenMeansNoAccess?: boolean } = {}
    ): Promise<T> {
      const key = apiKey
      if (!key) {
        throw new RiotApiError('No Riot API key configured', 401)
      }

      const recorder = beginRiotRequest(endpoint, baseUrl, path)
      // The limiter runs this closure from its pump loop, outside whatever async
      // context scheduled it, so the span context has to be carried across by hand.
      const spanContext = captureContext()

      let data: unknown
      try {
        data = await limiter.schedule(() =>
          runInContext(spanContext, async () => {
            recorder.attemptStarted()

            let response: Response
            try {
              response = await fetch(`${baseUrl}${path}`, {
                headers: { 'X-Riot-Token': key }
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
              const noAccess = response.status === 403 && options.forbiddenMeansNoAccess === true
              const err = new RiotApiError(
                `Riot API error ${response.status} for ${path}`,
                response.status,
                retryAfterMs,
                response.status === 400 && (await isDecryptFailure(response)),
                noAccess
              )
              recorder.attemptFailed(
                noAccess ? 'no_access' : err.isKeyRejection ? 'key_invalid' : 'http_error',
                response,
                err
              )
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
  }
}

/** The main key: League, accounts, and TFT too when there is no TFT key. */
export const mainScope = createRiotScope('main')

/** A TFT key of its own, with its own budget. Holds no key unless somebody added one. */
export const tftScope = createRiotScope('tft')

/** The main key's limiter, which is what "the rate limiter" meant before there were two. */
export const rateLimiter = mainScope.limiter

/** Called by keyStore.ts on startup (after decrypting) and whenever the user updates the key in Settings. */
export function setApiKey(key: string | null): void {
  mainScope.setKey(key)
}

export function hasApiKey(): boolean {
  return mainScope.hasKey()
}

/** The same, for the TFT key. Null takes it away, and TFT goes back to the main key. */
export function setTftApiKey(key: string | null): void {
  tftScope.setKey(key)
}

export function hasTftApiKey(): boolean {
  return tftScope.hasKey()
}

/**
 * Which key TFT is asked through right now — and so which key's id an account
 * has in TFT's eyes, since Riot encrypts a puuid against the key that asked.
 */
export function tftKeyScope(): RiotKeyScope {
  return tftScope.hasKey() ? 'tft' : 'main'
}

/** A call through the main key. See RiotScope.request. */
export function riotRequest<T>(endpoint: string, baseUrl: string, path: string, schema: Schema<T>): Promise<T> {
  return mainScope.request(endpoint, baseUrl, path, schema)
}

/**
 * A call to TFT, through the TFT key when there is one and the main key when
 * there is not.
 *
 * On the main key a 403 means the key was never granted TFT, the same status
 * Riot gives an expired key, so it is read as "no TFT here" and never latches
 * the main key's limiter: League keeps syncing. An expired main key is caught
 * by the next League call instead. On a TFT key of its own, a 403 is that key
 * being refused, as it would be on any key.
 */
export function tftRequest<T>(endpoint: string, baseUrl: string, path: string, schema: Schema<T>): Promise<T> {
  return tftScope.hasKey()
    ? tftScope.request(endpoint, baseUrl, path, schema)
    : mainScope.request(endpoint, baseUrl, path, schema, { forbiddenMeansNoAccess: true })
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

/** "This key cannot reach TFT" — a 403 from TFT on the main key. */
export function isNoProductAccess(err: unknown): boolean {
  return err instanceof RiotApiError && err.noProductAccess
}
