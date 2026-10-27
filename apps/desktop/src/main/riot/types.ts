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

export const ChampionMasteryDtoSchema = z.object({
  championId: z.number(),
  championPoints: z.number(),
  championLevel: z.number(),
  lastPlayTime: z.number()
})
export type ChampionMasteryDto = z.infer<typeof ChampionMasteryDtoSchema>

// ── TFT ──────────────────────────────────────────────────────────────────────
//
// Lenient where League's are strict. TFT's payload has changed shape set to set
// — fields renamed, others added each set — and the raw JSON is stored anyway,
// so only what a row is drawn from is required and everything else passes
// through. Riot spells TFT's in snake_case.

/** A TFT ladder: tier, division and LP, or Hyper Roll's colour and rating instead. */
export const TftLeagueEntryDtoSchema = z
  .object({
    queueType: z.string(),
    tier: z.string().optional(),
    rank: z.string().optional(),
    leaguePoints: z.number().optional(),
    wins: z.number().optional(),
    losses: z.number().optional(),
    ratedTier: z.string().optional(),
    ratedRating: z.number().optional()
  })
  .passthrough()
export type TftLeagueEntryDto = z.infer<typeof TftLeagueEntryDtoSchema>

const TftTraitDtoSchema = z
  .object({
    name: z.string(),
    num_units: z.number().default(0),
    style: z.number().default(0),
    tier_current: z.number().default(0),
    tier_total: z.number().default(0)
  })
  .passthrough()

const TftUnitDtoSchema = z
  .object({
    character_id: z.string(),
    tier: z.number().default(1),
    rarity: z.number().default(0),
    itemNames: z.array(z.string()).optional()
  })
  .passthrough()

export const TftParticipantDtoSchema = z
  .object({
    puuid: z.string(),
    riotIdGameName: z.string().optional(),
    riotIdTagline: z.string().optional(),
    placement: z.number(),
    level: z.number().default(0),
    last_round: z.number().default(0),
    // Left absent rather than defaulted: a missing time is not "out at the first
    // second", and the board is stored with the lobby's length instead.
    time_eliminated: z.number().optional(),
    players_eliminated: z.number().default(0),
    total_damage_to_players: z.number().default(0),
    gold_left: z.number().default(0),
    win: z.boolean().optional(),
    partner_group_id: z.number().optional(),
    traits: z.array(TftTraitDtoSchema).default([]),
    units: z.array(TftUnitDtoSchema).default([]),
    augments: z.array(z.string()).optional()
  })
  .passthrough()
export type TftParticipantDto = z.infer<typeof TftParticipantDtoSchema>

export const TftMatchDtoSchema = z.object({
  metadata: z
    .object({
      match_id: z.string(),
      participants: z.array(z.string()).default([])
    })
    .passthrough(),
  info: z
    .object({
      gameCreation: z.number().optional(),
      gameId: z.number().optional(),
      game_datetime: z.number(),
      game_length: z.number(),
      game_version: z.string().optional(),
      mapId: z.number().optional(),
      queueId: z.number().optional(),
      // The older spelling, still on payloads from before the rename.
      queue_id: z.number().optional(),
      tft_game_type: z.string().optional(),
      tft_set_core_name: z.string().optional(),
      tft_set_number: z.number().optional(),
      participants: z.array(TftParticipantDtoSchema)
    })
    .passthrough()
})
export type TftMatchDto = z.infer<typeof TftMatchDtoSchema>
