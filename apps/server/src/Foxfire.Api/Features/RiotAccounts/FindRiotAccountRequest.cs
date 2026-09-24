using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Data;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.RiotAccounts;

/// <summary>
/// One League account, by its Riot ID.
///
/// What a player's link names — /players/Faker-KR1 — and what the League client
/// says is signed in, so it is how a page finds its player and how the desktop
/// asks whether the account in front of it is tracked, and by whom.
///
/// An exact match on the name and the tag, which the unique index on the pair
/// answers without reading anything else. Riot IDs are not case-sensitive and
/// neither is that comparison: SQL Server's default collation is not either,
/// which is what the index was already relying on to keep one account from
/// being filed twice under two spellings.
/// </summary>
public sealed record FindRiotAccountRequest(string? GameName, string? TagLine)
    : IValidatedRequest<RiotAccountResponse>;

internal sealed class FindRiotAccountRequestValidator : AbstractValidator<FindRiotAccountRequest>
{
    public FindRiotAccountRequestValidator() =>
        RuleFor(x => x)
            .Must(r => (r.GameName ?? "").Trim().Length > 0 && (r.TagLine ?? "").TrimStart('#').Trim().Length > 0)
            .WithErrorCode("invalid_riot_id")
            .WithMessage("A Riot ID is a name and a tag, like Faker#KR.");
}

internal sealed class FindRiotAccountRequestHandler(FoxfireDbContext db, IIdentityContext me)
    : IValidatedRequestHandler<FindRiotAccountRequest, RiotAccountResponse>
{
    public async Task<Response<RiotAccountResponse>> Handle(
        FindRiotAccountRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        // Trimmed the way a link is, so a tag pasted with its hash still finds
        // the account filed without one.
        var gameName = (request.GameName ?? "").Trim();
        var tagLine = (request.TagLine ?? "").TrimStart('#').Trim();

        var account = await db.RiotAccounts
            .Include(a => a.Owner)
            .FirstOrDefaultAsync(a => a.GameName == gameName && a.TagLine == tagLine, cancellationToken);

        return account is null
            ? Response<RiotAccountResponse>.NotFound()
            : Response<RiotAccountResponse>.Success(RiotAccountResponse.Describe(account, me.UserId));
    }
}
