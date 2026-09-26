using Foxfire.Api.Common;
using Foxfire.Api.Reads;
using Foxfire.Api.Sync;
using Foxfire.Core;

namespace Foxfire.Api.Features.Ranks;

/// <summary>
/// The games awaiting a figure.
///
/// Gated on who may write, even though it is a read, unlike everything else. It
/// is the editor's list rather than a view of the history — offering somebody
/// the games on an account they cannot write to would be offering them a form
/// that cannot be submitted. That is the owner, or a head admin.
/// </summary>
public sealed record GetEditableGamesRequest(Guid RiotAccountId, string QueueType)
    : IDomainRequest<IReadOnlyList<EditableMatchResponse>>;

internal sealed class GetEditableGamesRequestHandler(AccountOwnership ownership, ManualRankEditor editor)
    : IDomainRequestHandler<GetEditableGamesRequest, IReadOnlyList<EditableMatchResponse>>
{
    public async Task<Response<IReadOnlyList<EditableMatchResponse>>> Handle(
        GetEditableGamesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await ownership.RankWritableAsync(request.RiotAccountId, cancellationToken);
        if (account is null)
        {
            return Response<IReadOnlyList<EditableMatchResponse>>.Failure(
                AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);
        }

        if (RankedQueues.FromRiotName(request.QueueType) is not { } queue)
        {
            return new Error("unknown_queue", $"{request.QueueType} is not a ranked queue.");
        }

        return Response<IReadOnlyList<EditableMatchResponse>>.Success(
            await editor.EditableAsync(request.RiotAccountId, account.Puuid, queue, cancellationToken));
    }
}

/// <summary>A batch of hand-entered figures for one ladder.</summary>
public sealed record SaveManualRanksRequest(
    Guid RiotAccountId,
    string QueueType,
    IReadOnlyList<ManualRankEditDto> Edits) : IEmptyDomainRequest;

internal sealed class SaveManualRanksRequestHandler(
    AccountOwnership ownership,
    ManualRankEditor editor,
    IServerEvents events,
    IIdentityContext me,
    ILogger<SaveManualRanksRequestHandler> logger)
    : IDomainRequestHandler<SaveManualRanksRequest>
{
    public async Task<Response> Handle(SaveManualRanksRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await ownership.RankWritableAsync(request.RiotAccountId, cancellationToken);
        if (account is null) return Response.Failure(AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);

        if (RankedQueues.FromRiotName(request.QueueType) is not { } queue)
        {
            return new Error("unknown_queue", $"{request.QueueType} is not a ranked queue.");
        }

        // A tier that is not a tier is the one thing ManualRank cannot hold, so
        // it is refused for the batch rather than dropped from it: a save that
        // silently skipped the one edit it could not read would look exactly
        // like a save that worked.
        var edits = (request.Edits ?? []).Select(e => e.ToDomain()).ToList();
        if (edits.Exists(e => e is null)) return new Error("invalid_rank", "Pick a tier");

        var problem = await editor.SaveAsync(
            request.RiotAccountId,
            account.Puuid,
            queue,
            [.. edits.Select(e => e!)],
            cancellationToken);

        if (problem is not null) return new Error("invalid_rank", problem);

        // Who wrote somebody else's history. The owner typing their own LP is
        // an ordinary edit and the request line says enough about it.
        if (!ownership.Owns(account))
        {
            logger.LogInformation(
                "{Actor} typed LP for {Count} game(s) on {RiotId}", me.Username, edits.Count, account.RiotId);
        }

        // The window that has to react is usually not the one that called: the
        // LP editor is its own renderer with its own cache, and the match list
        // and rank graph it just changed are in the main window — here and on
        // everybody else's machine.
        await events.RankEditedAsync(request.RiotAccountId, cancellationToken);

        return Response.Success();
    }
}

/// <summary>Removes one hand-entered figure, and the reading it was stored as.</summary>
public sealed record ClearManualRankRequest(Guid RiotAccountId, string MatchId) : IEmptyDomainRequest;

internal sealed class ClearManualRankRequestHandler(
    AccountOwnership ownership,
    ManualRankEditor editor,
    IServerEvents events,
    IIdentityContext me,
    ILogger<ClearManualRankRequestHandler> logger)
    : IDomainRequestHandler<ClearManualRankRequest>
{
    public async Task<Response> Handle(ClearManualRankRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var account = await ownership.RankWritableAsync(request.RiotAccountId, cancellationToken);
        if (account is null) return Response.Failure(AccountOwnership.NotYours, AccountOwnership.NotYoursStatus);

        var cleared = await editor.ClearAsync(
            request.RiotAccountId, account.Puuid, request.MatchId, cancellationToken);

        if (!cleared) return Response.NotFound();

        if (!ownership.Owns(account))
        {
            logger.LogInformation(
                "{Actor} cleared the hand-entered LP for {MatchId} on {RiotId}",
                me.Username,
                request.MatchId,
                account.RiotId);
        }

        await events.RankEditedAsync(request.RiotAccountId, cancellationToken);
        return Response.Success();
    }
}
