/**
 * The match id hiding in a .rofl file's name.
 *
 * Riot names every replay it downloads after the game it came from:
 * `NA1-5312345678.rofl`. Match-v5 calls that same game `NA1_5312345678`. The two
 * differ by one character, which makes linking a replay to its match a string
 * swap rather than a fingerprint — and the answer is known the instant the file
 * appears, minutes before match-v5 will admit the game exists.
 *
 * That single fact is why replays need none of the binding machinery recordings
 * do. There is no roster to compare, no clock skew to tolerate, and nothing to
 * retry: either the name is Riot's, or it is not.
 *
 * Kept deliberately strict. A file called `my best pentakill.rofl` returns null
 * and falls through to fingerprinting, which is the honest answer — guessing
 * from a renamed file is the exact mistake this function exists to avoid.
 */

/**
 * Platform prefixes are letters followed by an optional digit (NA1, EUW1, KR,
 * OC1). The game id is digits alone, and always long. Anything else is
 * somebody's own filing system.
 */
const RIOT_NAME = /^([A-Z]{2,5}\d{0,2})-(\d{6,})$/i

export function matchIdFromRoflName(fileName: string): string | null {
  const base = fileName.replace(/\.rofl$/i, '')
  const parts = RIOT_NAME.exec(base)
  if (parts === null) return null

  const platform = parts[1]
  const gameId = parts[2]
  if (platform === undefined || gameId === undefined) return null

  // Platform ids are upper case everywhere else in the schema — matches.match_id
  // comes straight from Riot — so normalise rather than trust the filesystem,
  // which on Windows hands back whatever case the file was created with.
  return `${platform.toUpperCase()}_${gameId}`
}

/**
 * The name Foxfire gives its own copy.
 *
 * Riot's name is reused when there is one: a folder named after its matches is
 * worth more than one full of opaque ids, and it keeps the copy recognisable
 * beside the original. Anything else is reduced to a safe stem, because these
 * names reach the filesystem and, for an archived client, a command line.
 */
export function copyFileName(matchId: string | null, sourceName: string): string {
  if (matchId !== null) return `${matchId.replace('_', '-')}.rofl`

  const stem = sourceName
    .replace(/\.rofl$/i, '')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
    .slice(0, 80)

  // A name made entirely of punctuation sanitises down to separators, which are
  // truthy and would sail past a plain empty check into a file called "_.rofl".
  return `${/[a-z0-9]/i.test(stem) ? stem : 'replay'}.rofl`
}

/**
 * The numeric game id inside a match id.
 *
 * `NA1_5624743500` -> `5624743500`. The League client keys its replay routes on
 * this rather than on the full match id or a path, so it is needed any time a
 * replay is handed back to the client to play.
 */
export function gameIdFromMatchId(matchId: string | null): string | null {
  if (matchId === null) return null
  const parts = /^[A-Z0-9]+_(\d+)$/i.exec(matchId)
  return parts?.[1] ?? null
}
