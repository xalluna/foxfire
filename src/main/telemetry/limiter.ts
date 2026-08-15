import { rateLimiter } from '../riot/client'
import { observeDispatch } from './resources'

/**
 * Subscribes to the rate limiter's `dispatch` event.
 *
 * The limiter has emitted `{ queueDepth }` on every dispatch since it was
 * written and nothing has ever listened. Attaching here gives queue depth and a
 * liveness signal for the sampler's cadence without touching rateLimiter.ts at
 * all.
 *
 * Kept in its own module so telemetry/resources.ts never has to import the Riot
 * client — that direction would close a cycle, since the client imports the
 * telemetry recorder.
 */
export function observeRateLimiter(): void {
  rateLimiter.on('dispatch', (event: { queueDepth: number }) => {
    observeDispatch(event.queueDepth)
  })
}
