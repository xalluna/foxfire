import type { ReplayEvent } from '@shared/types'

/**
 * The game's own event feed, turned into timeline markers.
 *
 * Pure, with no network or DB, so the awkward cases have tests: an assist that
 * counts, a fight you were not in that does not, and the multikill the game
 * reports alongside the kills it is made of.
 *
 * Only events involving the tracked player are kept. A forty-minute game
 * produces a hundred-odd events and a bar carrying all of them is a smear; the
 * question a replay answers is "what happened to me at fourteen minutes", and
 * every marker that is not about you makes that harder to answer.
 */

/** One entry of /liveclientdata/eventdata, with only the fields we read. */
export interface LiveEventDto {
  EventID?: number | null
  EventName?: string | null
  /** Seconds on the game clock, from the game's own start. */
  EventTime?: number | null
  KillerName?: string | null
  VictimName?: string | null
  Assisters?: string[] | null
  KillStreak?: number | null
}

/**
 * Every spelling of the tracked player the feed might use.
 *
 * The event feed names players by their in-game display name, while the
 * scoreboard endpoint carries a full Riot ID — the two do not always agree, so
 * the caller supplies both and the comparison takes any of them.
 */
export function selfNameSet(names: ReadonlyArray<string | null | undefined>): Set<string> {
  const set = new Set<string>()
  for (const name of names) {
    if (!name) continue
    const trimmed = name.trim()
    if (trimmed === '') continue
    set.add(trimmed.toLowerCase())
    // A Riot ID also matches on its game-name half, which is what the event
    // feed actually prints.
    const hash = trimmed.indexOf('#')
    if (hash > 0) set.add(trimmed.slice(0, hash).toLowerCase())
  }
  return set
}

function isSelf(name: string | null | undefined, selfNames: ReadonlySet<string>): boolean {
  return typeof name === 'string' && selfNames.has(name.trim().toLowerCase())
}

/**
 * Turns one raw event into a marker, or null if it is not about the player.
 *
 * `offset` is the game clock at the first recorded frame. An event from before
 * recording began lands at a negative video time and is dropped: the footage
 * simply does not contain it, and a marker that seeks nowhere is worse than no
 * marker.
 */
export function toReplayEvent(
  dto: LiveEventDto,
  selfNames: ReadonlySet<string>,
  offset: number
): ReplayEvent | null {
  const eventId = dto.EventID
  const name = dto.EventName
  const gameTime = dto.EventTime
  if (typeof eventId !== 'number' || typeof name !== 'string' || typeof gameTime !== 'number') {
    return null
  }

  const videoTime = gameTime - offset
  if (videoTime < 0) return null

  const base = { eventId, name, gameTime, videoTime }

  if (name === 'ChampionKill') {
    if (isSelf(dto.KillerName, selfNames)) {
      return { ...base, role: 'kill', label: dto.VictimName ?? null }
    }
    if (isSelf(dto.VictimName, selfNames)) {
      return { ...base, role: 'death', label: dto.KillerName ?? null }
    }
    if ((dto.Assisters ?? []).some((assister) => isSelf(assister, selfNames))) {
      return { ...base, role: 'assist', label: dto.VictimName ?? null }
    }
    return null
  }

  if (name === 'Multikill' && isSelf(dto.KillerName, selfNames)) {
    // Kept alongside the kills it is made of rather than replacing them. The
    // kills are where the fight actually happened; the multikill is the thing
    // worth finding again, and it wants its own marker.
    return {
      ...base,
      role: 'multikill',
      label: dto.KillStreak != null ? String(dto.KillStreak) : null
    }
  }

  // FirstBlood, Ace, turrets and objectives all pass through here to null. The
  // first two duplicate a ChampionKill that is already on the bar; the rest are
  // not about the player.
  return null
}

/**
 * Maps a whole feed.
 *
 * The endpoint returns every event of the game on every call, so this is fed
 * overlapping input by design and the caller stores the result with
 * INSERT OR IGNORE. Sorting by video time here means the timeline never has to.
 */
export function toReplayEvents(
  events: readonly LiveEventDto[],
  selfNames: ReadonlySet<string>,
  offset: number
): ReplayEvent[] {
  return events
    .map((event) => toReplayEvent(event, selfNames, offset))
    .filter((event): event is ReplayEvent => event !== null)
    .sort((a, b) => a.videoTime - b.videoTime)
}
