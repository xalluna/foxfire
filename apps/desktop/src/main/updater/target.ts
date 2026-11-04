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
 * Local-only answers to the servers this install is still signed in to
 * (`signedIn`): "Use this PC" keeps the credential so coming back needs no
 * password, and every way from one server to another passes through here. A
 * build newer than one of them accepts would be refused there on the way back,
 * so local-only is capped by the lowest of them, and held while any of them
 * cannot be reached. Only an install signed in to no server at all takes the
 * newest there is.
 */
export function resolveTarget(options: {
  current: string
  server: ActiveServer | null
  newest: string | null
  /** In local-only mode, each server this install is still signed in to, as it answered. */
  signedIn?: ActiveServer[]
}): UpdateDecision {
  const { current, server, newest } = options

  if (server === null && options.signedIn?.length) {
    const strictest = strictestOf(options.signedIn)
    return strictest === null ? { kind: 'unknown' } : resolveTarget({ current, server: strictest, newest })
  }

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
 * Whether a build already downloaded may still be installed.
 *
 * electron-updater installs what it has downloaded on the next quit, whatever
 * this module decided since — so a download that finished for one server has to
 * be asked about again whenever the answer could have changed: a switch of
 * server, the download finishing after one, and every scheduled check. The
 * authority is the same as for choosing a build: the active server, or locally
 * the strictest server this install is still signed in to. Withdrawn when that
 * authority accepts something older, or cannot be asked — the reason an
 * unreachable server holds rather than falls back.
 */
export function pendingVerdict(options: {
  pending: string
  server: ActiveServer | null
  signedIn?: ActiveServer[]
}): 'keep' | 'withdraw' {
  const { pending, server } = options

  const authority = server ?? (options.signedIn?.length ? strictestOf(options.signedIn) : undefined)

  // Local-only and signed in nowhere: the newest release is anybody's to run.
  if (authority === undefined) return 'keep'
  if (authority === null || !authority.reachable) return 'withdraw'
  return isNewer(authority.recommended, pending) ? 'withdraw' : 'keep'
}

/**
 * The server accepting the oldest build, or null when any of them could not be
 * asked — one that cannot answer might accept less than all the rest.
 */
function strictestOf(servers: ActiveServer[]): (ActiveServer & { reachable: true }) | null {
  let strictest: (ActiveServer & { reachable: true }) | null = null
  for (const server of servers) {
    if (!server.reachable) return null
    if (strictest === null || isNewer(server.recommended, strictest.recommended)) strictest = server
  }
  return strictest
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
