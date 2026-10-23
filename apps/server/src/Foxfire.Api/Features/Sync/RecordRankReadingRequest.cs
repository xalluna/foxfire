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
    bool Force,
    string? RatedTier = null,
    int? RatedRating = null,
    string? Game = null) : IValidatedRequest<RankReadingResponse>;

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
    public RecordRankReadingRequestValidator()
    {
        ClassLevelCascadeMode = CascadeMode.Stop;

        // Any game's ladder: the League client reports TFT's ladders beside
        // League's, and the queue type alone says which game a reading is of.
        RuleFor(x => x.QueueType)
            .Must(queue => RankedQueues.FromRiotName(queue) is not null)
            .WithErrorCode("unknown_queue")
            .WithMessage(x => $"{x.QueueType} is not a ranked queue this server tracks.");

        RuleFor(x => x.Game).MustNameAGame();

        // A game named alongside it must agree, or one of the two is wrong.
        RuleFor(x => x)
            .Must(x => x.Game is null || RankedQueues.FromRiotName(x.QueueType)?.Game().Slug() == x.Game)
            .WithErrorCode("game_mismatch")
            .WithMessage(x => $"{x.QueueType} is not one of {x.Game}'s ladders.");
    }
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
    TftIdentity tftIdentity,
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
                request.Losses,
                RatedTiers.FromRiotName(request.RatedTier),
                request.RatedRating),
            RankSources.Lcu,
            time.GetUtcNow().ToUnixTimeMilliseconds(),
            request.Force,
            cancellationToken);

        if (!wrote) return new RankReadingResponse(false);

        await db.SaveChangesAsync(cancellationToken);

        var since = time.GetUtcNow().ToUnixTimeMilliseconds() - AttributionRunner.ReplayWindowMs;
        var game = RankedQueues.FromRiotName(request.QueueType)!.Value.Game();

        // TFT's games are filed under the account's TFT puuid, which differs
        // from League's when the server has a TFT key of its own.
        var puuid = game == Game.Tft
            ? await tftIdentity.PuuidAsync(account, Foxfire.Riot.RiotRequestPriority.Interactive, cancellationToken)
            : account.Puuid;

        await attribution.ReplayAsync(account.Id, game, puuid, since, cancellationToken);

        // Everybody's rank views, not just this machine's. A game that just
        // ended moved somebody's LP, and a member watching the shared history
        // should see it without pressing anything.
        await events.RankChangedAsync(account.Id, cancellationToken);

        return new RankReadingResponse(true);
    }
}
