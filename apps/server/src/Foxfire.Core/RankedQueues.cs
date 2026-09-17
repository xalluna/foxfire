namespace Foxfire.Core;

/// <summary>The only two queues that carry an LP ladder.</summary>
public enum RankedQueue
{
    SoloDuo,
    Flex
}

/// <summary>
/// Which ladder a game counts towards.
///
/// An enum rather than the raw strings the desktop passes around, because these
/// two values cross a database, an HTTP boundary and a Riot payload, and a typo
/// in any of them would silently file a game against nothing.
/// </summary>
public static class RankedQueues
{
    /// <summary>The ladders Foxfire tracks rank and LP history for.</summary>
    public static readonly IReadOnlyList<RankedQueue> All = [RankedQueue.SoloDuo, RankedQueue.Flex];

    /// <summary>Riot's own name for a queue, which is what the database stores.</summary>
    public static string RiotName(this RankedQueue queue) => queue switch
    {
        RankedQueue.SoloDuo => "RANKED_SOLO_5x5",
        RankedQueue.Flex => "RANKED_FLEX_SR",
        _ => throw new ArgumentOutOfRangeException(nameof(queue))
    };

    /// <summary>The queue id whose matches move this ladder.</summary>
    public static int QueueId(this RankedQueue queue) => queue switch
    {
        RankedQueue.SoloDuo => 420,
        RankedQueue.Flex => 440,
        _ => throw new ArgumentOutOfRangeException(nameof(queue))
    };

    /// <summary>The ladder a queue id moves, or null for an unranked queue.</summary>
    public static RankedQueue? FromQueueId(int? queueId) => queueId switch
    {
        420 => RankedQueue.SoloDuo,
        440 => RankedQueue.Flex,
        _ => null
    };

    /// <summary>The ladder a stored queue type names, or null if it names neither.</summary>
    public static RankedQueue? FromRiotName(string? riotName) => riotName switch
    {
        "RANKED_SOLO_5x5" => RankedQueue.SoloDuo,
        "RANKED_FLEX_SR" => RankedQueue.Flex,
        _ => null
    };

    public static bool IsRanked(int? queueId) => FromQueueId(queueId) is not null;
}
