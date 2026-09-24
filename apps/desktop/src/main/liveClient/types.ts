import { z } from 'zod'

/**
 * The shape of https://127.0.0.1:2999/liveclientdata/allgamedata, as far as
 * capture reads it: the clock, and who is playing what.
 *
 * Every field is nullish and every object passes through, deliberately. This
 * payload is produced by whatever game build happens to be installed rather
 * than by a versioned web API, so it drifts between patches with no warning and
 * no changelog, and one unexpected player must not fail the parse for the whole
 * roster — nine recognisable players are not worth losing to the tenth.
 *
 * The cost is that a shape change arrives as empty fields rather than as a loud
 * error. Accepted deliberately — a recording with one champion unidentified
 * beats a game that never starts recording.
 */

export const LivePlayerSchema = z
  .object({
    riotIdGameName: z.string().nullish(),
    riotIdTagLine: z.string().nullish(),
    /** The display name, localised. */
    championName: z.string().nullish(),
    /** "game_character_displayname_Aatrox" — locale-independent, so preferred. */
    rawChampionName: z.string().nullish()
  })
  .passthrough()
export type LivePlayerDto = z.infer<typeof LivePlayerSchema>

export const AllGameDataSchema = z
  .object({
    activePlayer: z
      .object({
        riotId: z.string().nullish()
      })
      .passthrough()
      .nullish(),
    allPlayers: z.array(LivePlayerSchema).nullish(),
    gameData: z
      .object({
        gameTime: z.number().nullish()
      })
      .passthrough()
      .nullish()
  })
  .passthrough()
export type AllGameDataDto = z.infer<typeof AllGameDataSchema>
