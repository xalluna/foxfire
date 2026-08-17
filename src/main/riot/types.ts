import { z } from 'zod'

// Validating Riot's responses at this boundary means a changed/malformed
// payload fails loudly here instead of silently corrupting the local DB.

export const AccountDtoSchema = z.object({
  puuid: z.string(),
  gameName: z.string(),
  tagLine: z.string()
})
export type AccountDto = z.infer<typeof AccountDtoSchema>

export const SummonerDtoSchema = z.object({
  puuid: z.string(),
  id: z.string().optional(), // encryptedSummonerId — kept only as optional metadata, never a lookup key
  profileIconId: z.number(),
  revisionDate: z.number(),
  summonerLevel: z.number()
})
export type SummonerDto = z.infer<typeof SummonerDtoSchema>

export const LeagueEntryDtoSchema = z.object({
  puuid: z.string().optional(),
  queueType: z.string(),
  tier: z.string().optional(),
  rank: z.string().optional(),
  leaguePoints: z.number().optional(),
  wins: z.number().optional(),
  losses: z.number().optional()
})
export type LeagueEntryDto = z.infer<typeof LeagueEntryDtoSchema>

export const MatchIdsResponseSchema = z.array(z.string())

const PerksSchema = z.object({
  statPerks: z.object({
    defense: z.number(),
    flex: z.number(),
    offense: z.number()
  }),
  styles: z.array(
    z.object({
      description: z.string(),
      style: z.number(),
      selections: z.array(
        z.object({
          perk: z.number(),
          var1: z.number(),
          var2: z.number(),
          var3: z.number()
        })
      )
    })
  )
})

export const MatchParticipantDtoSchema = z
  .object({
    puuid: z.string(),
    riotIdGameName: z.string().optional(),
    riotIdTagline: z.string().optional(),
    teamId: z.number(),
    win: z.boolean(),
    championId: z.number(),
    championName: z.string(),
    champLevel: z.number(),
    kills: z.number(),
    deaths: z.number(),
    assists: z.number(),
    goldEarned: z.number(),
    totalMinionsKilled: z.number(),
    neutralMinionsKilled: z.number(),
    totalDamageDealtToChampions: z.number(),
    totalDamageTaken: z.number(),
    item0: z.number(),
    item1: z.number(),
    item2: z.number(),
    item3: z.number(),
    item4: z.number(),
    item5: z.number(),
    item6: z.number(),
    summoner1Id: z.number(),
    summoner2Id: z.number(),
    teamPosition: z.string().optional(),
    // Absent on very old matches, so optional rather than required.
    largestMultiKill: z.number().optional(),
    // The role quest reward, which occupies its own slot rather than item0-6.
    // Absent on matches played before the season it shipped in — required here
    // would abort the sync of any account with older history.
    roleBoundItem: z.number().optional(),
    // True when the game was voided as a remake. Such games award no LP and are
    // excluded from champion stats, matching how op.gg reports them.
    gameEndedInEarlySurrender: z.boolean().optional(),
    perks: PerksSchema
  })
  .passthrough()
export type MatchParticipantDto = z.infer<typeof MatchParticipantDtoSchema>

export const MatchDtoSchema = z.object({
  metadata: z.object({
    matchId: z.string(),
    participants: z.array(z.string())
  }),
  info: z
    .object({
      gameCreation: z.number(),
      gameDuration: z.number(),
      gameMode: z.string(),
      gameType: z.string(),
      queueId: z.number(),
      platformId: z.string(),
      participants: z.array(MatchParticipantDtoSchema)
    })
    .passthrough()
})
export type MatchDto = z.infer<typeof MatchDtoSchema>

export const ActiveGameParticipantDtoSchema = z
  .object({
    puuid: z.string(),
    teamId: z.number(),
    championId: z.number(),
    spell1Id: z.number(),
    spell2Id: z.number(),
    riotId: z.string().optional() // "gameName#tagLine" on newer payloads, absent on some
  })
  .passthrough()

export const ActiveGameDtoSchema = z.object({
  gameId: z.number(),
  gameMode: z.string(),
  gameLength: z.number(),
  participants: z.array(ActiveGameParticipantDtoSchema)
})
export type ActiveGameDto = z.infer<typeof ActiveGameDtoSchema>

export const ChampionMasteryDtoSchema = z.object({
  championId: z.number(),
  championPoints: z.number(),
  championLevel: z.number(),
  lastPlayTime: z.number()
})
export type ChampionMasteryDto = z.infer<typeof ChampionMasteryDtoSchema>
