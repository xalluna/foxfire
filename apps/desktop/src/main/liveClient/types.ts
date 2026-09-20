import { z } from 'zod'

/**
 * The shape of https://127.0.0.1:2999/liveclientdata/allgamedata.
 *
 * Every field is nullish and every object passes through, deliberately. This
 * payload is produced by whatever game build happens to be installed rather
 * than by a versioned web API, so it drifts between patches with no warning and
 * no changelog, and one unexpected player must not fail the parse for the whole
 * board — nine visible players are not worth losing to the tenth.
 *
 * The cost is that a shape change arrives as empty fields rather than as a loud
 * error. Accepted deliberately — an empty column beats a blank screen mid-game.
 */

const ItemSchema = z
  .object({
    itemID: z.number().nullish(),
    /** 0-5 are bought, 6 is the trinket. */
    slot: z.number().nullish(),
    count: z.number().nullish()
  })
  .passthrough()

const ScoresSchema = z
  .object({
    kills: z.number().nullish(),
    deaths: z.number().nullish(),
    assists: z.number().nullish(),
    creepScore: z.number().nullish(),
    wardScore: z.number().nullish()
  })
  .passthrough()

/** Summoner spells arrive by display name only — there is no id anywhere in this payload. */
const SummonerSpellSchema = z
  .object({
    displayName: z.string().nullish(),
    rawDisplayName: z.string().nullish()
  })
  .passthrough()

/** Runes, unlike spells and champions, do carry their numeric ids. */
const RuneSchema = z
  .object({
    id: z.number().nullish(),
    displayName: z.string().nullish()
  })
  .passthrough()

export const LivePlayerSchema = z
  .object({
    riotId: z.string().nullish(),
    riotIdGameName: z.string().nullish(),
    riotIdTagLine: z.string().nullish(),
    /** The display name, localised. */
    championName: z.string().nullish(),
    /** "game_character_displayname_Aatrox" — locale-independent, so preferred. */
    rawChampionName: z.string().nullish(),
    /** TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY, or "" in modes without lanes. */
    position: z.string().nullish(),
    level: z.number().nullish(),
    isBot: z.boolean().nullish(),
    isDead: z.boolean().nullish(),
    respawnTimer: z.number().nullish(),
    /** ORDER is blue, CHAOS is red. */
    team: z.string().nullish(),
    items: z.array(ItemSchema).nullish(),
    scores: ScoresSchema.nullish(),
    summonerSpells: z
      .object({
        summonerSpellOne: SummonerSpellSchema.nullish(),
        summonerSpellTwo: SummonerSpellSchema.nullish()
      })
      .passthrough()
      .nullish(),
    runes: z
      .object({
        keystone: RuneSchema.nullish(),
        primaryRuneTree: RuneSchema.nullish(),
        secondaryRuneTree: RuneSchema.nullish()
      })
      .passthrough()
      .nullish()
  })
  .passthrough()
export type LivePlayerDto = z.infer<typeof LivePlayerSchema>

export const AllGameDataSchema = z
  .object({
    activePlayer: z
      .object({
        riotId: z.string().nullish(),
        summonerName: z.string().nullish()
      })
      .passthrough()
      .nullish(),
    allPlayers: z.array(LivePlayerSchema).nullish(),
    gameData: z
      .object({
        gameMode: z.string().nullish(),
        gameTime: z.number().nullish(),
        mapName: z.string().nullish()
      })
      .passthrough()
      .nullish()
  })
  .passthrough()
export type AllGameDataDto = z.infer<typeof AllGameDataSchema>
