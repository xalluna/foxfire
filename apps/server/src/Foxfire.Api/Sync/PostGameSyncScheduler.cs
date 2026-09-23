using Foxfire.Riot;

namespace Foxfire.Api.Sync;

/// <summary>
/// Looking for the game that just ended, and being patient about it.
///
/// Riot does not publish a match to match-v5 the moment it ends — the client
/// reaches its end-of-game screen well before the API will list the game, and
/// how long that takes varies. A single attempt fired on the end-of-game signal
/// therefore usually finds nothing, which is exactly the failure this exists to
/// remove: it would look fixed most evenings and broken on the rest.
///
/// So it retries on a widening schedule until the match lands. A delta sync is
/// two requests plus one per genuinely new match, so the cost of being patient
/// is small even against one shared personal key. The last attempt sits at ten
/// minutes because a match that has not appeared by then will not be caught by
/// trying once more — the next sync for that account will get it.
///
/// The ladder moved to the server from the desktop for a reason beyond tidiness:
/// it has to keep running after the person who played closes their laptop, and
/// two people in the same game must not run it twice. Both fall out of it living
/// here — the second signal for a match joins the first account's schedule or
/// starts that account's own, and neither is anybody's open application.
/// </summary>
public sealed class PostGameSyncScheduler(
    SyncService sync,
    TimeProvider time,
    ILogger<PostGameSyncScheduler> log) : IAsyncDisposable
{
    /// <summary>
    /// Thirty seconds, then a minute and a half, three, six, ten.
    ///
    /// Widening rather than uniform: most games appear inside the first two
    /// attempts, and the later ones exist for the evenings when Riot is slow
    /// rather than for the ordinary case.
    /// </summary>
    public static readonly IReadOnlyList<TimeSpan> RetryDelays =
    [
        TimeSpan.FromSeconds(30),
        TimeSpan.FromSeconds(90),
        TimeSpan.FromMinutes(3),
        TimeSpan.FromMinutes(6),
        TimeSpan.FromMinutes(10)
    ];

    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, CancellationTokenSource> _pending = [];
    private readonly CancellationTokenSource _stopping = new();

    /// <summary>Whether a ladder is currently waiting on this account.</summary>
    public bool IsScheduled(Guid riotAccountId)
    {
        lock (_gate) return _pending.ContainsKey(riotAccountId);
    }

    /// <summary>
    /// Starts looking for a newly finished game.
    ///
    /// Replaces any schedule already pending for the account rather than running
    /// two in parallel: back-to-back games are the normal case, and the later
    /// game's schedule subsumes the earlier one — a delta sync fetches everything
    /// new, so the first game is picked up by the second game's attempts anyway.
    /// </summary>
    public void Schedule(Guid riotAccountId)
    {
        CancellationTokenSource cts;

        lock (_gate)
        {
            if (_stopping.IsCancellationRequested) return;

            if (_pending.Remove(riotAccountId, out var previous))
            {
                previous.Cancel();
                previous.Dispose();
            }

            cts = CancellationTokenSource.CreateLinkedTokenSource(_stopping.Token);
            _pending[riotAccountId] = cts;
        }

        log.LogInformation(
            "Watching for a finished game on {RiotAccountId} ({Attempts} attempts)",
            riotAccountId,
            RetryDelays.Count);

        _ = Task.Run(() => RunLadderAsync(riotAccountId, cts.Token), CancellationToken.None);
    }

    private async Task RunLadderAsync(Guid riotAccountId, CancellationToken cancellationToken)
    {
        using var _ = log.BeginScope(new Dictionary<string, object> { ["RiotAccountId"] = riotAccountId });

        try
        {
            for (var attempt = 0; attempt < RetryDelays.Count; attempt++)
            {
                await Task.Delay(RetryDelays[attempt], time, cancellationToken);

                try
                {
                    var result = await sync.SyncAsync(riotAccountId, SyncTrigger.Auto, cancellationToken);
                    if (result.Stored > 0)
                    {
                        log.LogInformation(
                            "Post-game sync stored {Stored} match(es) for {RiotAccountId} on attempt {Attempt}",
                            result.Stored,
                            riotAccountId,
                            attempt + 1);

                        return;
                    }
                }
                catch (RiotApiException ex) when (ex.IsKeyRejection)
                {
                    // A rejected key fails every remaining attempt the same way —
                    // the limiter latches paused until the server is restarted
                    // with a new one — so stop rather than spending four more
                    // requests proving it.
                    log.LogDebug("Post-game sync abandoned: Riot rejected this server's API key");
                    return;
                }
                catch (Exception ex)
                {
                    log.LogDebug(
                        ex, "Post-game sync attempt {Attempt} failed for {RiotAccountId}", attempt + 1, riotAccountId);
                }
            }

            log.LogDebug("Post-game sync gave up; the match never appeared for {RiotAccountId}", riotAccountId);
        }
        catch (OperationCanceledException)
        {
            // Superseded by a later game, or the server is stopping. Either way
            // there is nothing to report.
        }
        finally
        {
            lock (_gate)
            {
                if (_pending.TryGetValue(riotAccountId, out var mine) && mine.Token == cancellationToken)
                {
                    _pending.Remove(riotAccountId);
                    mine.Dispose();
                }
            }
        }
    }

    /// <summary>Drops every pending schedule, so nothing outlives the process.</summary>
    public async ValueTask DisposeAsync()
    {
        await _stopping.CancelAsync();

        lock (_gate)
        {
            foreach (var cts in _pending.Values) cts.Dispose();
            _pending.Clear();
        }

        _stopping.Dispose();
    }
}
