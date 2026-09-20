namespace Foxfire.Core;

/// <summary>What re-resolving an account from its Riot ID turned out to mean.</summary>
public enum IdentityOutcome
{
    /// <summary>The puuid moved, and the stored history has been rewritten onto the new one.</summary>
    Repaired,

    /// <summary>Riot has no account under that Riot ID any more. Almost always a rename.</summary>
    Unresolved,

    /// <summary>The lookup itself failed — a rate limit, a timeout, a rejected key.</summary>
    Failed,

    /// <summary>Riot rejected the puuid and then handed back the same one.</summary>
    Unchanged
}

/// <summary>Whether to try the failed request again, and what to say if not.</summary>
public sealed record IdentityRepairPlan(bool Retry, string? Message);

/// <summary>
/// What a sync should fetch, decided without touching a database or a network.
///
/// Ported from the desktop's src/main/services/syncPlanning.ts, which is
/// deliberately free of imports for the same reason this is a static class with
/// no dependencies: these are the decisions worth testing directly, and they are
/// the ones most easily buried inside a method that also does I/O.
/// </summary>
public static class SyncPlanning
{
    /// <summary>
    /// Given Riot's newest-first id list and the newest id already stored,
    /// returns only the ones newer than it.
    ///
    /// A marker that does not appear in the page means the stored history is
    /// older than this whole page, so everything in it is new.
    /// </summary>
    public static IReadOnlyList<string> SelectNewMatchIds(
        IReadOnlyList<string> allIds,
        string? mostRecentMatchId)
    {
        ArgumentNullException.ThrowIfNull(allIds);

        if (string.IsNullOrEmpty(mostRecentMatchId)) return [.. allIds];

        var known = -1;
        for (var i = 0; i < allIds.Count; i++)
        {
            if (allIds[i] == mostRecentMatchId)
            {
                known = i;
                break;
            }
        }

        if (known < 0) return [.. allIds];

        return [.. allIds.Take(known)];
    }

    /// <summary>Page sizes for a backfill run, respecting Riot's 100-per-request maximum.</summary>
    public static IReadOnlyList<int> PlanMatchIdPages(int target, int pageSize)
    {
        if (pageSize <= 0) throw new ArgumentOutOfRangeException(nameof(pageSize));

        List<int> pages = [];
        var remaining = target;
        while (remaining > 0)
        {
            var count = Math.Min(pageSize, remaining);
            pages.Add(count);
            remaining -= count;
        }

        return pages;
    }

    /// <summary>
    /// What a sync should do once Riot has rejected its puuid and the account has
    /// been re-resolved.
    ///
    /// Only a puuid that actually changed earns a retry. The other three outcomes
    /// all mean the same request would fail the same way a second time, and each
    /// has its own thing to tell somebody — a rename needs hands on it, a
    /// rejected key needs the host, and a puuid Riot both rejects and reissues
    /// unchanged is a genuinely strange state that should be reported rather than
    /// papered over with a retry loop.
    ///
    /// The messages differ from the desktop's in who they address. There, the
    /// person reading them owns the key and the account and can fix either. Here
    /// the reader is a member of somebody else's server, so a message telling
    /// them to replace an API key would be telling the wrong person.
    /// </summary>
    public static IdentityRepairPlan AfterIdentityRepair(IdentityOutcome outcome, string riotId) =>
        outcome switch
        {
            IdentityOutcome.Repaired => new IdentityRepairPlan(true, null),

            IdentityOutcome.Unresolved => new IdentityRepairPlan(
                false,
                $"Riot no longer knows {riotId} — if the account was renamed, link it again under the new Riot ID."),

            IdentityOutcome.Failed => new IdentityRepairPlan(
                false,
                $"Could not reach Riot to re-link {riotId}. Syncing again later should pick it up."),

            IdentityOutcome.Unchanged => new IdentityRepairPlan(
                false,
                $"Riot rejected the stored id for {riotId} but hands back the same one. "
                + "This server's administrator may need a fresh API key."),

            _ => new IdentityRepairPlan(false, $"Could not re-link {riotId}.")
        };
}
