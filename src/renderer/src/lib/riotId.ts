import type { RiotIdInput } from '@shared/types'

/**
 * Accepts "Name#TAG" or a bare name (defaulting to the NA1 tag).
 *
 * Riot IDs may themselves contain '#', so the split is on the LAST one.
 */
export function parseRiotId(raw: string): RiotIdInput | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const hashIndex = trimmed.lastIndexOf('#')
  if (hashIndex === -1) return { gameName: trimmed, tagLine: 'NA1' }

  const gameName = trimmed.slice(0, hashIndex).trim()
  const tagLine = trimmed.slice(hashIndex + 1).trim()
  if (!gameName || !tagLine) return null

  return { gameName, tagLine }
}

export function formatRiotId(gameName: string | null, tagLine: string | null): string {
  if (!gameName) return 'Unknown'
  return tagLine ? `${gameName}#${tagLine}` : gameName
}
