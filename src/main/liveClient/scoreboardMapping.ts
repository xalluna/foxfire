// Pure mapping from the running game's own view of itself to the rows the
// scoreboard draws. Deliberately free of any database, network or Electron
// imports so it stays trivially testable, in the manner of syncPlanning.ts.

import { byPosition, isPosition } from '@shared/positions'
import type { Account, AssetManifest, Scoreboard, ScoreboardPlayer } from '@shared/types'
import type { AllGameDataDto, LivePlayerDto } from './types'

/** How many inventory slots the game reports; index 6 is the trinket. */
const INVENTORY_SLOTS = 7

/** The prefix the game puts in front of every champion's Data Dragon key. */
const RAW_CHAMPION_PREFIX = 'game_character_displayname_'

/**
 * The Live Client Data payload names champions and summoner spells but numbers
 * neither, while the rest of the app — icons, match history, every asset helper
 * — is keyed on Riot's numeric ids. Inverting the manifest here means the
 * renderer never learns that this screen has a different data source.
 *
 * Two indexes per lookup because the name the game sends is localised: the Data
 * Dragon key (`MonkeyKing`) is stable across languages and is tried first, with
 * the display name (`Wukong`) as the fallback.
 */
interface Lookups {
  championIdByKey: Map<string, number>
  championIdByName: Map<string, number>
  spellIdByName: Map<string, number>
}

function buildLookups(manifest: AssetManifest): Lookups {
  const championIdByKey = new Map<string, number>()
  const championIdByName = new Map<string, number>()
  for (const [id, champion] of Object.entries(manifest.championById)) {
    championIdByKey.set(champion.id.toLowerCase(), Number(id))
    championIdByName.set(champion.name.toLowerCase(), Number(id))
  }

  const spellIdByName = new Map<string, number>()
  for (const [id, spell] of Object.entries(manifest.spellById)) {
    const name = spell.name.toLowerCase()
    const existing = spellIdByName.get(name)
    // Display names are not unique — ids 32 and 39 are both "Mark", the snowball
    // and its URF variant. Keeping the lower id makes the choice deterministic
    // and picks the one anybody outside an event mode is actually holding.
    if (existing === undefined || Number(id) < existing) spellIdByName.set(name, Number(id))
  }

  return { championIdByKey, championIdByName, spellIdByName }
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

function spellId(displayName: string | null | undefined, lookups: Lookups): number | null {
  if (!displayName) return null
  return lookups.spellIdByName.get(displayName.toLowerCase()) ?? null
}

/**
 * The game reports only the slots a player is actually holding, so a build with
 * a hole in it arrives shorter than one without. Rebuilding a dense array keeps
 * the trinket at index 6 where itemSlots() expects to find it.
 *
 * Anything past the inventory is the lane's quest reward, which is granted
 * rather than bought and gets its own field for the same reason it does on a
 * stored match.
 */
function inventory(player: LivePlayerDto): { items: number[]; roleBoundItem: number } {
  const items = Array.from({ length: INVENTORY_SLOTS }, () => 0)
  let roleBoundItem = 0

  for (const item of player.items ?? []) {
    const slot = item?.slot
    const id = item?.itemID
    if (typeof slot !== 'number' || typeof id !== 'number') continue
    if (slot >= 0 && slot < INVENTORY_SLOTS) items[slot] = id
    else if (slot >= INVENTORY_SLOTS) roleBoundItem = id
  }

  return { items, roleBoundItem }
}

/**
 * Blank is the same as absent.
 *
 * The game reports a player it has no identity for as empty strings rather than
 * as missing keys, and `??` does not catch those — a row came back named '' and
 * tagged '', which rendered as a nameless row and sent an empty Riot ID off to
 * be looked up. Observed in a real ARAM, on one player out of ten.
 */
function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

/** ORDER is blue, CHAOS is red — the same two sides match-v5 numbers 100 and 200. */
function teamId(team: string | null | undefined): number {
  return team === 'CHAOS' ? 200 : 100
}

function toPlayer(
  player: LivePlayerDto,
  slot: number,
  lookups: Lookups,
  isSelf: boolean
): ScoreboardPlayer {
  const { items, roleBoundItem } = inventory(player)
  const scores = player.scores

  return {
    slot,
    gameName: text(player.riotIdGameName),
    tagLine: text(player.riotIdTagLine),
    isSelf,
    isBot: player.isBot ?? false,
    isDead: player.isDead ?? false,
    respawnTimer: player.isDead ? (player.respawnTimer ?? 0) : 0,
    level: player.level ?? null,
    position: isPosition(player.position) ? player.position : null,
    teamId: teamId(player.team),
    championId: championId(player, lookups),
    championName: text(player.championName),
    spell1Id: spellId(player.summonerSpells?.summonerSpellOne?.displayName, lookups),
    spell2Id: spellId(player.summonerSpells?.summonerSpellTwo?.displayName, lookups),
    keystoneId: player.runes?.keystone?.id ?? null,
    secondaryTreeId: player.runes?.secondaryRuneTree?.id ?? null,
    items,
    roleBoundItem,
    kills: scores?.kills ?? 0,
    deaths: scores?.deaths ?? 0,
    assists: scores?.assists ?? 0,
    creepScore: scores?.creepScore ?? 0,
    wardScore: scores?.wardScore ?? 0
  }
}

/** Case-insensitive, because the game echoes back whatever casing the player typed. */
function sameRiotId(gameName: string | null, tagLine: string | null, riotId: string): boolean {
  if (gameName === null) return false
  const full = tagLine === null ? gameName : `${gameName}#${tagLine}`
  return full.toLowerCase() === riotId.toLowerCase()
}

/**
 * Builds the board, each side already in lane order.
 *
 * Blue's five come before red's, and within a side the rows read down the map —
 * top, jungle, mid, bot, support — which is the order the game's own scoreboard
 * uses and the one the roster arrives in from nowhere else. A mode without
 * lanes reports "NONE" for everybody, so nothing is recognised and the roster
 * keeps the order the game sent it in.
 */
export function toScoreboard(
  data: AllGameDataDto,
  manifest: AssetManifest,
  account: Account
): Scoreboard {
  const lookups = buildLookups(manifest)
  const rows = data.allPlayers ?? []

  // The tracked account first — this window is showing somebody in particular —
  // and only whoever is at the keyboard when that account is not in the game.
  // Resolved to a single Riot ID up front so the two can never both match and
  // highlight two rows.
  const matches = (riotId: string): boolean =>
    rows.some((p) => sameRiotId(text(p.riotIdGameName), text(p.riotIdTagLine), riotId))
  const accountRiotId = `${account.gameName}#${account.tagLine}`
  const selfRiotId = matches(accountRiotId) ? accountRiotId : (data.activePlayer?.riotId ?? null)

  const players = rows.map((player, slot) =>
    toPlayer(
      player,
      slot,
      lookups,
      selfRiotId !== null && sameRiotId(text(player.riotIdGameName), text(player.riotIdTagLine), selfRiotId)
    )
  )

  return {
    gameMode: data.gameData?.gameMode ?? '',
    mapName: data.gameData?.mapName ?? '',
    gameTime: data.gameData?.gameTime ?? 0,
    players: [
      ...byPosition(
        players.filter((p) => p.teamId === 100),
        (p) => p.position
      ),
      ...byPosition(
        players.filter((p) => p.teamId === 200),
        (p) => p.position
      )
    ]
  }
}
