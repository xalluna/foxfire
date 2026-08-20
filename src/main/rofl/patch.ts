/**
 * Which client can play which replay.
 *
 * A .rofl is not a video. It is a command log the game engine replays, so it
 * only means anything to the build that produced it: hand last month's replay
 * to today's client and it refuses, because the units it describes no longer
 * behave the way they did. That is a property of Riot's format, not something
 * Foxfire can work around — the most it can do is know which install to reach
 * for, and say so plainly when there isn't one.
 *
 * Matching is on major.minor and nothing finer. Riot ships hotfixes inside a
 * patch without breaking replay compatibility, so requiring the build digits to
 * agree would orphan a replay recorded four hours ago and look, correctly, like
 * a bug.
 */

/** A League install able to run replays from one patch. */
export interface Runner {
  /** major.minor, e.g. "15.14". */
  patch: string
  /** The install root — the directory holding Game\. */
  path: string
  /**
   * True for the install the player actually plays on. It is never stored: it
   * is always present, and its patch changes every two weeks, so a row
   * describing it would be wrong more often than right.
   */
  isLive: boolean
}

/**
 * "15.16.700.1234" -> "15.16".
 *
 * Accepts the three shapes the same number arrives in: the game executable's
 * version resource, the `gameVersion` in a .rofl header, and `info.gameVersion`
 * on a stored match. They agree on the first two components and disagree about
 * everything after, which is exactly the part being discarded.
 */
export function patchFromGameVersion(
  version: string | null | undefined
): string | null {
  if (typeof version !== 'string') return null
  const parts = /^\s*(\d+)\.(\d+)/.exec(version)
  if (parts === null) return null
  return `${parts[1]}.${parts[2]}`
}

/**
 * The install that can play a replay from `patch`, or null.
 *
 * The live install wins when it matches. It is the one guaranteed to be
 * complete and patched, and preferring it means the common case — watching a
 * game from today — never depends on the user having archived anything.
 *
 * A null `patch` means the header was unreadable. That is not the same as "no
 * runner exists", but it is the same outcome: nothing can be chosen safely, so
 * nothing is.
 */
export function runnerFor(
  patch: string | null,
  archives: ReadonlyArray<{ patch: string; path: string }>,
  livePatch: string | null,
  liveInstallPath: string | null
): Runner | null {
  if (patch === null) return null

  if (livePatch !== null && liveInstallPath !== null && livePatch === patch) {
    return { patch, path: liveInstallPath, isLive: true }
  }

  const archive = archives.find((candidate) => candidate.patch === patch)
  if (archive === undefined) return null

  return { patch, path: archive.path, isLive: false }
}

/**
 * Why this replay cannot be watched, or null when it can.
 *
 * Phrased for a menu item that stays visible while disabled, the convention the
 * match context menu already sets: a user asking "why can I watch that one and
 * not this one?" gets an answer instead of a missing row.
 */
export function replayBlockedReason(
  patch: string | null,
  runner: Runner | null
): string | null {
  if (patch === null) return 'Foxfire could not read this replay’s patch'
  if (runner === null) return `Needs a League client for patch ${patch}`
  return null
}
