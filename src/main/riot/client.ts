import { RiotApiError, RiotRateLimiter, PERSONAL_KEY_LIMITS } from './rateLimiter'

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

/**
 * Low-level fetch for any Riot endpoint. Always goes through the shared
 * rate limiter. Throws RiotApiError on non-2xx so the limiter can decide
 * whether to retry (429/5xx) or surface a key problem (401/403).
 */
export async function riotFetch<T>(baseUrl: string, path: string): Promise<T> {
  if (!currentApiKey) {
    throw new RiotApiError('No Riot API key configured', 401)
  }

  return rateLimiter.schedule(async () => {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: { 'X-Riot-Token': currentApiKey! }
    })

    if (response.status === 404) {
      throw new RiotApiError('Not found', 404)
    }

    if (!response.ok) {
      const retryAfterHeader = response.headers.get('Retry-After')
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
      throw new RiotApiError(`Riot API error ${response.status} for ${path}`, response.status, retryAfterMs)
    }

    return (await response.json()) as T
  })
}

/** Distinguishes "confirmed not found" from other failures, since callers often treat 404 as a valid empty result. */
export function isNotFound(err: unknown): boolean {
  return err instanceof RiotApiError && err.status === 404
}
