// Pure mapping from the running game's own view of itself to what a recording
// needs from it. Deliberately free of any database, network or Electron imports
// so it stays trivially testable, in the manner of syncPlanning.ts.

import type { AssetManifest } from '@shared/types'
import type { AllGameDataDto, LivePlayerDto } from './types'

/**
 * One player in the game on this machine, as far as capture cares: who they
 * are, and what they are playing.
 *
 * The game's own view of itself carries no puuid, so a player is identified by
 * their Riot ID and nothing else.
 */
export interface ScoreboardPlayer {
  gameName: string | null
  tagLine: string | null
  /** The account being recorded, so its events can be picked out of the feed. */
  isSelf: boolean
  /** Null for a champion the manifest has not caught up with. */
  championId: number | null
}

export interface Scoreboard {
  /** Seconds elapsed. */
  gameTime: number
  /** In the order the game listed them. */
  players: ScoreboardPlayer[]
}

/** The prefix the game puts in front of every champion's Data Dragon key. */
const RAW_CHAMPION_PREFIX = 'game_character_displayname_'

/**
 * The Live Client Data payload names champions but does not number them, while
 * the rest of the app — the roster a recording is matched to its game by, every
 * stored match — is keyed on Riot's numeric ids. Inverting the manifest here
 * means nothing downstream learns that this source is different.
 *
 * Two indexes because the name the game sends is localised: the Data Dragon key
 * (`MonkeyKing`) is stable across languages and is tried first, with the display
 * name (`Wukong`) as the fallback.
 */
interface Lookups {
  championIdByKey: Map<string, number>
  championIdByName: Map<string, number>
}

function buildLookups(manifest: AssetManifest): Lookups {
  const championIdByKey = new Map<string, number>()
  const championIdByName = new Map<string, number>()
  for (const [id, champion] of Object.entries(manifest.championById)) {
    championIdByKey.set(champion.id.toLowerCase(), Number(id))
    championIdByName.set(champion.name.toLowerCase(), Number(id))
  }

  return { championIdByKey, championIdByName }
}

function championId(player: LivePlayerDto, lookups: Lookups): number | null {
  const raw = player.rawChampionName
  if (raw) {
    const key = raw.startsWith(RAW_CHAMPION_PREFIX) ? raw.slice(RAW_CHAMPION_PREFIX.length) : raw
    const byKey = lookups.championIdByKey.get(key.toLowerCase())
    if (byKey !== undefined) return byKey
  }

  const byName = player.championName
    ? lookups.championIdByName.get(player.championName.toLowerCase())
    : undefined
  return byName ?? null
}

/**
 * Blank is the same as absent.
 *
 * The game reports a player it has no identity for as empty strings rather than
 * as missing keys, and `??` does not catch those — a row came back named '' and
 * tagged '', which would otherwise be taken for a real Riot ID. Observed in a
 * real ARAM, on one player out of ten.
 */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** Case-insensitive, because the game echoes back whatever casing the player typed. */
function sameRiotId(gameName: string | null, tagLine: string | null, riotId: string): boolean {
  if (gameName === null) return false
  const full = tagLine === null ? gameName : `${gameName}#${tagLine}`
  return full.toLowerCase() === riotId.toLowerCase()
}

export function toScoreboard(
  data: AllGameDataDto,
  manifest: AssetManifest,

  // `gameName#tagLine`, which is the only thing this ever wanted from an
  // account and the one identity that means the same on any server.
  accountRiotId: string
): Scoreboard {
  const lookups = buildLookups(manifest)
  const rows = data.allPlayers ?? []

  // The tracked account first — that is whose game is being recorded — and
  // only whoever is at the keyboard when that account is not in the game.
  // Resolved to a single Riot ID up front so the two can never both match and
  // mark two players as self.
  const matches = (riotId: string): boolean =>
    rows.some((p) => sameRiotId(text(p.riotIdGameName), text(p.riotIdTagLine), riotId))

  const selfRiotId = matches(accountRiotId) ? accountRiotId : (data.activePlayer?.riotId ?? null)

  return {
    gameTime: data.gameData?.gameTime ?? 0,
    players: rows.map((player) => {
      const gameName = text(player.riotIdGameName)
      const tagLine = text(player.riotIdTagLine)
      return {
        gameName,
        tagLine,
        isSelf: selfRiotId !== null && sameRiotId(gameName, tagLine, selfRiotId),
        championId: championId(player, lookups)
      }
    })
  }
}
