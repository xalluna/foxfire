using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Sync;

namespace Foxfire.Api.Features.Import;

/// <summary>
/// Which of these games the server has never stored.
///
/// What lets a re-upload send three days of history instead of a year of it. A
/// stats.db is asked about by id — a few bytes each — and only the payloads the
/// server answers for are sent, where every one of them is 100–200 KB. Sending
/// a payload the server already holds is not wrong, only wasteful: the matches
/// batch skips what it has, so this is an optimisation and never something an
/// import depends on. A client that cannot ask, because the server is older than
/// this route, sends everything and gets the same result more slowly.
/// </summary>
public sealed record UnstoredMatchesRequest(IReadOnlyList<string> MatchIds)
    : IValidatedRequest<IReadOnlyList<string>>
{
    public int Count => MatchIds?.Count ?? 0;
}

/// <summary>
/// A bigger page than the payload batches allow, because an id is a few bytes
/// where those are megabytes — a thousand of them is a request about the size of
/// one match.
/// </summary>
internal sealed class UnstoredMatchesRequestValidator : AbstractValidator<UnstoredMatchesRequest>
{
    public const int MaxIds = 1000;

    public UnstoredMatchesRequestValidator() =>
        RuleFor(x => x.Count)
            .LessThanOrEqualTo(MaxIds)
            .WithErrorCode("batch_too_large")
            .WithMessage($"Ask about at most {MaxIds} matches at a time.");
}

internal sealed class UnstoredMatchesRequestHandler(MatchIngestion ingestion)
    : IValidatedRequestHandler<UnstoredMatchesRequest, IReadOnlyList<string>>
{
    public async Task<Response<IReadOnlyList<string>>> Handle(
        UnstoredMatchesRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        return Response<IReadOnlyList<string>>.Success(
            await ingestion.FilterUnstoredAsync(request.MatchIds ?? [], cancellationToken));
    }
}
