import type { FavoriteOutcome, FavoritePlayer, LeagueEntry, PlayerSearchResult } from '../types'

/**
 * The most players one list holds.
 *
 * The search box opens on them, above your own accounts, before anything is
 * typed — ten is a list you can read at a glance, and a longer one would push
 * your own accounts out of the box it opens in.
 */
export const FAVORITES_LIMIT = 10

/** The solo queue entry of a profile's entries, which is what a favorite carries. */
export function soloEntryOf(entries: readonly LeagueEntry[]): LeagueEntry | null {
  return entries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? null
}

/**
 * The copy of a player a favorite keeps.
 *
 * `isHomeAccount` is left off because it is a fact about one moment's list of
 * yours, not about the player: the copy would go on saying "home" long after
 * something else was.
 */
export function favoriteSnapshot(player: PlayerSearchResult, addedAt: string): FavoritePlayer {
  return {
    account: { ...player.account, isHomeAccount: false },
    soloEntry: player.soloEntry,
    addedAt
  }
}

/**
 * Stars a player, newest first.
 *
 * Somebody already starred keeps their place and takes the newer copy, so
 * starring twice from two screens is not a reordering. A full list refuses
 * rather than dropping the oldest: which of ten people to stop following is
 * not a choice to make on somebody's behalf.
 */
export function addFavorite(
  list: readonly FavoritePlayer[],
  player: PlayerSearchResult,
  addedAt: string
): FavoriteOutcome {
  const at = list.findIndex((f) => f.account.id === player.account.id)
  if (at !== -1) {
    const favorites = [...list]
    favorites[at] = favoriteSnapshot(player, list[at].addedAt)
    return { ok: true, favorites }
  }

  if (list.length >= FAVORITES_LIMIT) return { ok: false, reason: 'full', favorites: [...list] }

  return { ok: true, favorites: [favoriteSnapshot(player, addedAt), ...list] }
}

export function removeFavorite(list: readonly FavoritePlayer[], accountId: string): FavoritePlayer[] {
  return list.filter((f) => f.account.id !== accountId)
}

/**
 * The list, with anybody in it brought up to what was just seen of them.
 *
 * Null when nothing changed, so a caller has nothing to write. A copy is only
 * replaced by one at least as new — a page that kept an older answer on screen
 * while it asked again must not undo a newer one — and only when something the
 * list draws actually differs.
 */
export function refreshFavorites(
  list: readonly FavoritePlayer[],
  seen: readonly PlayerSearchResult[]
): FavoritePlayer[] | null {
  const byId = new Map(seen.map((p) => [p.account.id, p]))
  let changed = false

  const favorites = list.map((favorite) => {
    const fresh = byId.get(favorite.account.id)
    if (!fresh || freshness(fresh) < freshness(favorite) || sameAsDrawn(fresh, favorite)) {
      return favorite
    }
    changed = true
    return favoriteSnapshot(fresh, favorite.addedAt)
  })

  return changed ? favorites : null
}

/** The later of when the account and its rank were last read, as epoch ms. */
function freshness(player: PlayerSearchResult): number {
  const account = Date.parse(player.account.updatedAt)
  const rank = player.soloEntry ? Date.parse(player.soloEntry.fetchedAt) : Number.NaN
  return Math.max(Number.isNaN(account) ? 0 : account, Number.isNaN(rank) ? 0 : rank)
}

function sameAsDrawn(a: PlayerSearchResult, b: PlayerSearchResult): boolean {
  return (
    a.account.gameName === b.account.gameName &&
    a.account.tagLine === b.account.tagLine &&
    a.account.profileIconId === b.account.profileIconId &&
    a.account.summonerLevel === b.account.summonerLevel &&
    (a.account.ownerUsername ?? null) === (b.account.ownerUsername ?? null) &&
    a.soloEntry?.tier === b.soloEntry?.tier &&
    a.soloEntry?.rank === b.soloEntry?.rank &&
    a.soloEntry?.leaguePoints === b.soloEntry?.leaguePoints
  )
}

/**
 * The list as it is kept, one string wherever this client keeps preferences.
 *
 * Versioned, because a copy of a player is a shape that will change and a
 * store written by this build will be read by the next.
 */
export function serializeFavorites(list: readonly FavoritePlayer[]): string {
  return JSON.stringify({ v: 1, players: list })
}

/**
 * The list back out of storage, whatever state it is in.
 *
 * Storage is somebody else's to break — a hand-edited file, an older build, a
 * browser that cleared half a key — and a list that cannot be read is an empty
 * one rather than a search box that throws. Anything unreadable in it is
 * dropped, the first of any duplicate kept, and it comes back newest first and
 * no longer than the limit.
 */
export function parseFavorites(raw: string | null): FavoritePlayer[] {
  if (!raw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  const players = (parsed as { v?: unknown; players?: unknown } | null)?.players
  if (!Array.isArray(players)) return []

  const seen = new Set<string>()
  const favorites: FavoritePlayer[] = []
  for (const item of players) {
    if (!isFavorite(item) || seen.has(item.account.id)) continue
    seen.add(item.account.id)
    favorites.push(item)
  }

  return favorites
    .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
    .slice(0, FAVORITES_LIMIT)
}

function isFavorite(item: unknown): item is FavoritePlayer {
  if (typeof item !== 'object' || item === null) return false
  const { account, soloEntry, addedAt } = item as Partial<FavoritePlayer>
  return (
    typeof addedAt === 'string' &&
    !Number.isNaN(Date.parse(addedAt)) &&
    typeof account === 'object' &&
    account !== null &&
    typeof account.id === 'string' &&
    typeof account.gameName === 'string' &&
    typeof account.tagLine === 'string' &&
    (soloEntry === null || (typeof soloEntry === 'object' && soloEntry !== undefined))
  )
}
