using System.Text.Json;
using System.Text.Json.Serialization;

namespace Foxfire.Riot;

/// <summary>
/// One player's standing on one ladder, from league-v4.
///
/// Almost every field is optional because Riot omits them rather than sending
/// nulls, and an unranked account simply has no entry for the queue at all —
/// which is why the absence of a row is meaningful and an empty list is not an
/// error.
/// </summary>
public sealed record LeagueEntryDto(
    [property: JsonPropertyName("queueType")] string QueueType,
    [property: JsonPropertyName("tier")] string? Tier,

    // Riot calls the division "rank". Renamed on the way in, because a property
    // called Rank next to one called Tier reads as the whole rank rather than
    // the number after it, and that confusion has cost real time.
    [property: JsonPropertyName("rank")] string? Division,

    [property: JsonPropertyName("leaguePoints")] int? LeaguePoints,
    [property: JsonPropertyName("wins")] int? Wins,
    [property: JsonPropertyName("losses")] int? Losses);

/// <summary>A champion's mastery figure. Lifetime, and queue-agnostic.</summary>
public sealed record ChampionMasteryDto(
    [property: JsonPropertyName("championId")] int ChampionId,
    [property: JsonPropertyName("championPoints")] int ChampionPoints,
    [property: JsonPropertyName("championLevel")] int ChampionLevel,
    [property: JsonPropertyName("lastPlayTime")] long LastPlayTime);

/// <summary>Profile trimmings from summoner-v4: icon and level, nothing identifying.</summary>
public sealed record SummonerDto(
    [property: JsonPropertyName("puuid")] string Puuid,
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("profileIconId")] int ProfileIconId,
    [property: JsonPropertyName("summonerLevel")] long SummonerLevel);

/// <summary>The ids and the roster, which is all the metadata block carries.</summary>
public sealed record MatchMetadataDto(
    [property: JsonPropertyName("matchId")] string MatchId,
    [property: JsonPropertyName("participants")] IReadOnlyList<string> Participants);

/// <summary>
/// One player's line in one game.
///
/// Every nullable field here is nullable because some era of match actually
/// omits it. <c>largestMultiKill</c> is missing on very old games,
/// <c>roleBoundItem</c> predates the season that introduced it, and
/// <c>gameEndedInEarlySurrender</c> predates remakes being reported at all —
/// requiring any of them would abort the backfill of any account with history,
/// which is the opposite of what a backfill is for.
/// </summary>
public sealed record MatchParticipantDto
{
    [JsonPropertyName("puuid")] public string Puuid { get; init; } = "";
    [JsonPropertyName("riotIdGameName")] public string? RiotIdGameName { get; init; }
    [JsonPropertyName("riotIdTagline")] public string? RiotIdTagline { get; init; }

    [JsonPropertyName("teamId")] public int TeamId { get; init; }
    [JsonPropertyName("win")] public bool Win { get; init; }

    [JsonPropertyName("championId")] public int ChampionId { get; init; }
    [JsonPropertyName("championName")] public string? ChampionName { get; init; }
    [JsonPropertyName("champLevel")] public int ChampLevel { get; init; }

    [JsonPropertyName("kills")] public int Kills { get; init; }
    [JsonPropertyName("deaths")] public int Deaths { get; init; }
    [JsonPropertyName("assists")] public int Assists { get; init; }
    [JsonPropertyName("goldEarned")] public int GoldEarned { get; init; }

    [JsonPropertyName("totalMinionsKilled")] public int TotalMinionsKilled { get; init; }
    [JsonPropertyName("neutralMinionsKilled")] public int NeutralMinionsKilled { get; init; }

    [JsonPropertyName("totalDamageDealtToChampions")] public int TotalDamageDealtToChampions { get; init; }
    [JsonPropertyName("totalDamageTaken")] public int TotalDamageTaken { get; init; }

    [JsonPropertyName("item0")] public int Item0 { get; init; }
    [JsonPropertyName("item1")] public int Item1 { get; init; }
    [JsonPropertyName("item2")] public int Item2 { get; init; }
    [JsonPropertyName("item3")] public int Item3 { get; init; }
    [JsonPropertyName("item4")] public int Item4 { get; init; }
    [JsonPropertyName("item5")] public int Item5 { get; init; }
    [JsonPropertyName("item6")] public int Item6 { get; init; }

    [JsonPropertyName("summoner1Id")] public int Summoner1Id { get; init; }
    [JsonPropertyName("summoner2Id")] public int Summoner2Id { get; init; }

    [JsonPropertyName("teamPosition")] public string? TeamPosition { get; init; }

    /// <summary>Absent on very old matches.</summary>
    [JsonPropertyName("largestMultiKill")] public int? LargestMultiKill { get; init; }

    /// <summary>The role quest reward, which occupies its own slot rather than item0-6.</summary>
    [JsonPropertyName("roleBoundItem")] public int? RoleBoundItem { get; init; }

    /// <summary>True when the game was voided as a remake. No LP, and excluded from champion stats.</summary>
    [JsonPropertyName("gameEndedInEarlySurrender")] public bool GameEndedInEarlySurrender { get; init; }

    /// <summary>
    /// Runes, kept as the element Riot sent rather than modelled.
    ///
    /// Nothing on the server reads inside it — the renderer does, and it does so
    /// from the same JSON — so modelling the tree here would be three record
    /// types that exist only to be re-serialised unchanged.
    /// </summary>
    [JsonPropertyName("perks")] public JsonElement Perks { get; init; }

    /// <summary>Minions and monsters, summed the way the schema stores them.</summary>
    public int Cs => TotalMinionsKilled + NeutralMinionsKilled;

    /// <summary>The six bought slots plus the trinket, in slot order.</summary>
    public int[] Items => [Item0, Item1, Item2, Item3, Item4, Item5, Item6];
}

/// <summary>The part of a match that is about the game rather than about the request.</summary>
public sealed record MatchInfoDto(
    [property: JsonPropertyName("gameCreation")] long GameCreation,
    [property: JsonPropertyName("gameDuration")] int GameDuration,
    [property: JsonPropertyName("gameMode")] string? GameMode,
    [property: JsonPropertyName("gameType")] string? GameType,
    [property: JsonPropertyName("queueId")] int QueueId,
    [property: JsonPropertyName("platformId")] string? PlatformId,
    [property: JsonPropertyName("participants")] IReadOnlyList<MatchParticipantDto> Participants);

/// <summary>
/// A whole game, as match-v5 sends it.
///
/// Carried alongside <see cref="RawMatch.RawJson"/> rather than re-serialised
/// from this: what gets stored has to be the bytes Riot sent, because the point
/// of keeping them is that a future column can be backfilled out of a field this
/// version of the code does not know exists. Re-serialising would keep only the
/// fields already modelled, which is precisely the information a backfill needs.
/// </summary>
public sealed record MatchDto(
    [property: JsonPropertyName("metadata")] MatchMetadataDto Metadata,
    [property: JsonPropertyName("info")] MatchInfoDto Info);

/// <summary>
/// A match and the exact text it arrived as.
///
/// Both, because they answer different questions and only one of them can be
/// derived from the other. Ingestion projects columns out of the parse and files
/// the text verbatim.
/// </summary>
public sealed record RawMatch(MatchDto Match, string RawJson);
