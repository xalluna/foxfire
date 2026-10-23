using System.Text.Json.Serialization;

namespace Foxfire.Riot;

/// <summary>
/// One player's standing on one TFT ladder, from tft-league-v1.
///
/// League's shape for Ranked and Double Up — tier, division, LP — and Hyper
/// Roll's for its rated ladder, which sends a coloured tier and a rating
/// instead and leaves the rest out.
/// </summary>
public sealed record TftLeagueEntryDto(
    [property: JsonPropertyName("queueType")] string QueueType,
    [property: JsonPropertyName("tier")] string? Tier,
    [property: JsonPropertyName("rank")] string? Division,
    [property: JsonPropertyName("leaguePoints")] int? LeaguePoints,
    [property: JsonPropertyName("wins")] int? Wins,
    [property: JsonPropertyName("losses")] int? Losses,
    [property: JsonPropertyName("ratedTier")] string? RatedTier,
    [property: JsonPropertyName("ratedRating")] int? RatedRating);

/// <summary>A trait on a board, as tft-match-v1 sends it.</summary>
public sealed record TftTraitDto(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("num_units")] int NumUnits,
    [property: JsonPropertyName("style")] int Style,
    [property: JsonPropertyName("tier_current")] int TierCurrent,
    [property: JsonPropertyName("tier_total")] int TierTotal);

/// <summary>A unit on a board.</summary>
public sealed record TftUnitDto(
    [property: JsonPropertyName("character_id")] string CharacterId,
    [property: JsonPropertyName("tier")] int Tier,
    [property: JsonPropertyName("rarity")] int Rarity,
    [property: JsonPropertyName("itemNames")] IReadOnlyList<string>? ItemNames);

/// <summary>
/// One player's board in one game.
///
/// tft-match-v1 is snake_case where match-v5 is camelCase, apart from the Riot
/// ID fields it borrowed from League — which older payloads do not carry at
/// all. Everything a sync depends on is required; the rest is optional because
/// Riot has added and dropped fields set by set.
/// </summary>
public sealed record TftParticipantDto
{
    [JsonPropertyName("puuid")] public string Puuid { get; init; } = "";
    [JsonPropertyName("riotIdGameName")] public string? RiotIdGameName { get; init; }
    [JsonPropertyName("riotIdTagline")] public string? RiotIdTagline { get; init; }

    [JsonPropertyName("placement")] public int Placement { get; init; }
    [JsonPropertyName("level")] public int Level { get; init; }
    [JsonPropertyName("last_round")] public int LastRound { get; init; }

    /// <summary>Seconds, fractional, from the start until this player was out.</summary>
    [JsonPropertyName("time_eliminated")] public double TimeEliminated { get; init; }

    [JsonPropertyName("players_eliminated")] public int PlayersEliminated { get; init; }
    [JsonPropertyName("total_damage_to_players")] public int TotalDamageToPlayers { get; init; }
    [JsonPropertyName("gold_left")] public int GoldLeft { get; init; }
    [JsonPropertyName("win")] public bool? Win { get; init; }

    /// <summary>Double Up's team. Absent in every other queue.</summary>
    [JsonPropertyName("partner_group_id")] public int? PartnerGroupId { get; init; }

    [JsonPropertyName("traits")] public IReadOnlyList<TftTraitDto>? Traits { get; init; }
    [JsonPropertyName("units")] public IReadOnlyList<TftUnitDto>? Units { get; init; }

    /// <summary>The augments picked, in sets that had them.</summary>
    [JsonPropertyName("augments")] public IReadOnlyList<string>? Augments { get; init; }
}

public sealed record TftMatchMetadataDto(
    [property: JsonPropertyName("match_id")] string MatchId,
    [property: JsonPropertyName("participants")] IReadOnlyList<string>? Participants);

/// <summary>
/// The game itself.
///
/// <see cref="GameCreation"/> is when the lobby was created, and is what every
/// other time in Foxfire's schema is measured against; Riot added it to TFT
/// later than to League. <see cref="GameDatetime"/>, the older field, is the
/// game's end, and is what a creation is worked back from when only it was
/// sent. The queue arrived as <c>queue_id</c> first and <c>queueId</c> later.
/// </summary>
public sealed record TftMatchInfoDto
{
    [JsonPropertyName("gameCreation")] public long? GameCreation { get; init; }
    [JsonPropertyName("gameId")] public long? GameId { get; init; }
    [JsonPropertyName("game_datetime")] public long GameDatetime { get; init; }
    [JsonPropertyName("game_length")] public double GameLength { get; init; }
    [JsonPropertyName("game_version")] public string? GameVersion { get; init; }
    [JsonPropertyName("mapId")] public int? MapId { get; init; }
    [JsonPropertyName("queueId")] public int? QueueId { get; init; }
    [JsonPropertyName("queue_id")] public int? LegacyQueueId { get; init; }
    [JsonPropertyName("tft_game_type")] public string? TftGameType { get; init; }
    [JsonPropertyName("tft_set_core_name")] public string? TftSetCoreName { get; init; }
    [JsonPropertyName("tft_set_number")] public int? TftSetNumber { get; init; }
    [JsonPropertyName("participants")] public IReadOnlyList<TftParticipantDto>? Participants { get; init; }
}

public sealed record TftMatchDto(
    [property: JsonPropertyName("metadata")] TftMatchMetadataDto Metadata,
    [property: JsonPropertyName("info")] TftMatchInfoDto Info);

/// <summary>A TFT game, parsed and verbatim — kept for the same reason as <see cref="RawMatch"/>.</summary>
public sealed record RawTftMatch(TftMatchDto Match, string RawJson);
