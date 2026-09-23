import { judge } from '@foxfire/core/server'

/**
 * What the active server says about itself, or null in local-only mode.
 *
 * A server that cannot be reached is its own case rather than an absent one.
 * The difference decides whether this build is allowed to move: see below.
 */
export type ActiveServer =
  | { name: string; reachable: false }
  | { name: string; reachable: true; recommended: string }

/** What to do about updates, once everything with a say has been asked. */
export type UpdateDecision =
  /** Fetch this version. Always newer than the one running. */
  | { kind: 'install'; version: string }
  /** Nothing to do — this is the newest build that may run here. */
  | { kind: 'current' }
  /** A newer build exists and the active server will not accept it yet. */
  | { kind: 'held'; serverName: string; allows: string; newest: string }
  /** Nobody could be asked. Try again later rather than guess. */
  | { kind: 'unknown' }

/**
 * Which version this copy should be running.
 *
 * The server's allow list is the authority, exactly as it is at connect time.
 * A desktop that updated past what its server knows would be refused by it —
 * 426, no service — so connected to a server this asks that server what it
 * accepts and installs that, and nothing newer. The grace window the server
 * leaves (a build on the list but behind) is what gives this time to land.
 *
 * Which makes an unreachable server a hold rather than a fallback. Falling back
 * to the newest release the moment a host's machine is down would install the
 * one build that server might refuse when it comes back, and it would do it
 * precisely when nobody could be told why.
 *
 * Local-only has no such authority, so it takes the newest there is.
 */
export function resolveTarget(options: {
  current: string
  server: ActiveServer | null
  newest: string | null
}): UpdateDecision {
  const { current, server, newest } = options

  if (server !== null) {
    if (!server.reachable) return { kind: 'unknown' }

    if (isNewer(current, server.recommended)) {
      return { kind: 'install', version: server.recommended }
    }

    // Up to date as far as this server is concerned. Say so out loud when
    // there is a newer build it has not been told about: the remedy is its
    // host updating the server, and somebody has to know to ask.
    if (newest !== null && isNewer(current, newest)) {
      return { kind: 'held', serverName: server.name, allows: server.recommended, newest }
    }

    return { kind: 'current' }
  }

  if (newest === null) return { kind: 'unknown' }
  return isNewer(current, newest) ? { kind: 'install', version: newest } : { kind: 'current' }
}

/**
 * Whether `candidate` is a later build than `mine`.
 *
 * Asked through the same judgement the server gate uses rather than a second
 * comparison written here, so the two can never disagree about what a version
 * string means — including refusing one they cannot parse, which `judge`
 * answers `unknown` for and this reads as "not newer". A version this app
 * cannot read is not one it should download and run.
 *
 * The range handed over is deliberately floored at this build: `judge` calls
 * anything below the minimum `unsupported`, so naming the candidate as both
 * ends would answer that for every upgrade. With `mine` as the floor the only
 * question left is whether the candidate sits above it, which is `outdated`.
 */
function isNewer(mine: string, candidate: string): boolean {
  return judge(mine, mine, candidate) === 'outdated'
}
