/**
 * Somewhere to say what happened.
 *
 * Core has no log of its own and should not: the desktop writes to a file under
 * its user data folder, and a browser has the console. So anything here that
 * has something worth saying takes one of these, and the desktop's own logger
 * already has this shape.
 */
export interface Logger {
  debug(message: string, context?: unknown): void
  info(message: string, context?: unknown): void
  /** `error` is a thrown value. */
  error(message: string, error?: unknown, context?: Record<string, unknown>): void
}

/** For callers with nowhere to write, and for tests. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  error: () => {}
}
