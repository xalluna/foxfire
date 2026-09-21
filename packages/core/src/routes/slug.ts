import type { RiotIdInput } from '../types'

/**
 * A player, as a path segment: `Faker-KR1` for Faker#KR1.
 *
 * The Riot ID rather than the server's id for the account, because a link is
 * read before it is opened — in a Discord message, a browser's history — and
 * "whose is this" should be answerable without clicking. The cost is that a
 * rename breaks old links, and the page they land on says so.
 *
 * `#` cannot appear in a path, so the tag line hangs off the last hyphen. A
 * game name may contain hyphens and a tag line may not, which is what makes the
 * last one the separator rather than the first.
 */
export function playerSlug(player: { gameName: string; tagLine: string }): string {
  return `${player.gameName}-${player.tagLine}`
}

/** The Riot ID a slug names, or null when it could not be one. */
export function parsePlayerSlug(slug: string): RiotIdInput | null {
  const trimmed = slug.trim()
  const at = trimmed.lastIndexOf('-')
  if (at <= 0 || at === trimmed.length - 1) return null

  const gameName = trimmed.slice(0, at).trim()
  const tagLine = trimmed.slice(at + 1).trim()
  if (!gameName || !tagLine) return null

  return { gameName, tagLine }
}

/**
 * Whether an account is the one a slug names.
 *
 * Riot IDs are compared without regard to case, as Riot compares them — a link
 * typed as faker-kr1 still means the same player.
 */
export function isPlayer(account: { gameName: string; tagLine: string }, riotId: RiotIdInput): boolean {
  return (
    account.gameName.toLowerCase() === riotId.gameName.toLowerCase() &&
    account.tagLine.toLowerCase() === riotId.tagLine.toLowerCase()
  )
}
