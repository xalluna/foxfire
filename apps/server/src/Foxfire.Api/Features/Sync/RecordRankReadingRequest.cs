using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;
using Foxfire.Core;
using Foxfire.Data;

namespace Foxfire.Api.Features.Sync;

/// <summary>
/// A rank reading the desktop took from a running League client.
///
/// <paramref name="Force"/> is what makes a game that moved no LP still count:
/// without a reading either side of it, the game before and the game after
/// share one interval and neither can be attributed.
/// </summary>
public sealed record RecordRankReadingRequest(
    Guid RiotAccountId,
    string QueueType,
    string? Tier,
    string? Division,
    int? LeaguePoints,
    int? Wins,
    int? Losses,
    bool Force) : IValidatedRequest<RankReadingResponse>;

/// <summary>
/// Whether the reading was actually filed.
///
/// Said out loud rather than left as a status code, because the desktop acts on
/// it: a forced reading that was written is what clears the watcher's wait for
/// a post-game value to settle, and one that was not means the client is still
/// serving the rank the player went in with.
/// </summary>
public sealed record RankReadingResponse(bool Recorded);

internal sealed class RecordRankReadingRequestValidator : AbstractValidator<RecordRankReadingRequest>
{
    public RecordRankReadingRequestValidator() =>
        RuleFor(x => x.QueueType)
            .Must(queue => RankedQueues.FromRiotName(queue) is not null)
            .WithErrorCode("unknown_queue")
            .WithMessage(x => $"{x.QueueType} is not a ranked queue this server tracks.");
}

/// <summary>
/// Files a reading the League client reported, and attributes what it closes.
///
/// The attribution afterwards is a fast path, not the guarantee: it lands only
/// when the game is already stored, which for a game that just ended it usually
/// is not. What actually closes the interval is the replay at the end of the
/// sync the post-game ladder is about to run.
/// </summary>
internal sealed class RecordRankReadingRequestHandler(
    AccountOwnership ownership,
    FoxfireDbContext db,
    RankRecorder ranks,
    AttributionRunner attribution,
    IServerEvents events,
    TimeProvider time)
    : IValidatedRequestHandler<RecordRankReadingRequest, RankReadingResponse>
{
    public async Task<Response<RankReadingResponse>> Handle(
        RecordRankReadingRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await ownership.MineAsync(request.RiotAccountId, cancellationToken);
        if (account is null)
        {
            return Response<RankReadingResponse>.Failure(
                AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);
        }

        var wrote = await ranks.RecordAsync(
            account.Id,
            new RankReadingInput(
                request.QueueType,

                // An unreadable tier is stored as unranked rather than refused:
                // the desktop is relaying whatever the League client said, and a
                // reading it cannot spell is still a reading.
                RankTiers.FromRiotName(request.Tier),
                RankDivisions.FromRiotName(request.Division),
                request.LeaguePoints,
                request.Wins,
                request.Losses),
            RankSources.Lcu,
            time.GetUtcNow().ToUnixTimeMilliseconds(),
            request.Force,
            cancellationToken);

        if (!wrote) return new RankReadingResponse(false);

        await db.SaveChangesAsync(cancellationToken);

        var since = time.GetUtcNow().ToUnixTimeMilliseconds() - AttributionRunner.ReplayWindowMs;
        await attribution.ReplayAsync(account.Id, account.Puuid, since, cancellationToken);

        // Everybody's rank views, not just this machine's. A game that just
        // ended moved somebody's LP, and a member watching the shared history
        // should see it without pressing anything.
        await events.RankChangedAsync(account.Id, cancellationToken);

        return new RankReadingResponse(true);
    }
}
