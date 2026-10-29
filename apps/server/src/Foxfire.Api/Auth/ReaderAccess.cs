using Foxfire.Api.Features.ShareLinks;
using Foxfire.Api.Reads;
using Foxfire.Api.Services;
using Foxfire.Api.Startup;
using Foxfire.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Auth;

/// <summary>The named policies this server's routes ask for.</summary>
public static class FoxfirePolicies
{
    /// <summary>
    /// Reading: a member, or anybody while the server is open, or whoever holds
    /// a share link for what the route reads. See <see cref="ReaderRequirement"/>.
    /// </summary>
    public const string Reader = "reader";
}

/// <summary>What a route reads, as a share link sees it.</summary>
public enum ShareScope
{
    /// <summary>One account's data: the route's account id must be the shared account.</summary>
    Account,

    /// <summary>A League game, by id: the shared account must have played it.</summary>
    LeagueGame,

    /// <summary>One account's TFT game: the shared account, and a game it played.</summary>
    TftGame,

    /// <summary>A Riot ID lookup: it must name the shared account.</summary>
    Lookup,

    /// <summary>Data that is nobody's — the seasons — which every page reads.</summary>
    Reference
}

/// <summary>
/// Endpoint metadata saying a share link can open this route, and how to tell
/// whether the one in hand does.
///
/// A read route with none of this is open to members and, on an open server, to
/// anybody — but never to a share link, which opens what is listed and nothing
/// else. So a new read is closed to share links until somebody decides it
/// belongs to a profile.
/// </summary>
/// <param name="AccountRouteValue">The route value holding the account id, for the scopes that read one.</param>
public sealed record ShareCoverage(ShareScope Scope, string AccountRouteValue = "riotAccountId")
{
    public static ShareCoverage Account { get; } = new(ShareScope.Account);
    public static ShareCoverage LeagueGame { get; } = new(ShareScope.LeagueGame);
    public static ShareCoverage TftGame { get; } = new(ShareScope.TftGame);
    public static ShareCoverage Lookup { get; } = new(ShareScope.Lookup);
    public static ShareCoverage Reference { get; } = new(ShareScope.Reference);
}

/// <summary>
/// Who may read.
///
/// Until this existed, every read was simply "signed in": everything on a
/// server is readable by every member, and that is still the first answer. The
/// two others are for somebody who is not a member — an outsider:
///
/// 1. The server is open (<see cref="ServerSettingsService.IsPublicAccessEnabledAsync"/>),
///    and then every read route is theirs.
/// 2. They hold a share link, and the route's <see cref="ShareCoverage"/> says it
///    reads the account the link opens.
///
/// Failing all three is a 401, as it always was, so a client that is not signed
/// in reads the refusal the way it always did. Writes never come through here:
/// they stay <c>RequireAuthorization()</c>, so nothing an outsider holds can
/// sync, type LP, spend the Riot key or download a replay.
///
/// What an outsider is shown differs from a member's too, and that is decided
/// in the handlers rather than here: a request with no user is an outsider's.
/// See <see cref="Features.RiotAccounts.RiotAccountResponse.Describe"/>.
/// </summary>
public sealed class ReaderRequirement : IAuthorizationRequirement;

internal sealed class ReaderAuthorizationHandler(
    ServerSettingsService settings,
    ShareAccess shares,
    FoxfireDbContext db,
    TftReads tft) : AuthorizationHandler<ReaderRequirement>
{
    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        ReaderRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            context.Succeed(requirement);
            return;
        }

        if (context.Resource is not HttpContext http) return;
        var cancellationToken = http.RequestAborted;

        if (await settings.IsPublicAccessEnabledAsync(cancellationToken))
        {
            context.Succeed(requirement);
            return;
        }

        if (http.GetEndpoint()?.Metadata.GetMetadata<ShareCoverage>() is not { } coverage) return;
        if (await shares.CurrentAsync(cancellationToken) is not { } shared) return;

        if (await CoversAsync(coverage, shared, http, cancellationToken)) context.Succeed(requirement);
    }

    private async Task<bool> CoversAsync(
        ShareCoverage coverage,
        SharedAccount shared,
        HttpContext http,
        CancellationToken cancellationToken)
    {
        switch (coverage.Scope)
        {
            case ShareScope.Reference:
                return true;

            case ShareScope.Account:
                return IsSharedAccount(coverage, shared, http);

            case ShareScope.Lookup:
                // Trimmed as FindRiotAccountRequest trims, and compared without
                // case, as the column's collation compares it there.
                var gameName = http.Request.Query["gameName"].ToString().Trim();
                var tagLine = http.Request.Query["tagLine"].ToString().TrimStart('#').Trim();
                return string.Equals(gameName, shared.GameName, StringComparison.OrdinalIgnoreCase)
                    && string.Equals(tagLine, shared.TagLine, StringComparison.OrdinalIgnoreCase);

            case ShareScope.LeagueGame:
                // The puuid the history is read by, so a game the link's
                // profile lists is a game it opens.
                var leagueMatch = MatchId(http);
                return leagueMatch is not null && await db.MatchParticipants.AsNoTracking()
                    .AnyAsync(p => p.MatchId == leagueMatch && p.Puuid == shared.Puuid, cancellationToken);

            case ShareScope.TftGame:
                if (!IsSharedAccount(coverage, shared, http)) return false;

                var tftMatch = MatchId(http);
                if (tftMatch is null) return false;

                var account = await db.RiotAccounts.AsNoTracking()
                    .FirstOrDefaultAsync(a => a.Id == shared.RiotAccountId, cancellationToken);
                var puuid = account is null ? null : await tft.PuuidAsync(account, cancellationToken);

                return puuid is not null && await db.TftParticipants.AsNoTracking()
                    .AnyAsync(p => p.MatchId == tftMatch && p.Puuid == puuid, cancellationToken);

            default:
                return false;
        }
    }

    private static bool IsSharedAccount(ShareCoverage coverage, SharedAccount shared, HttpContext http) =>
        Guid.TryParse(http.GetRouteValue(coverage.AccountRouteValue)?.ToString(), out var id)
        && id == shared.RiotAccountId;

    private static string? MatchId(HttpContext http) => http.GetRouteValue("matchId")?.ToString();
}

/// <summary>
/// A read refused to somebody carrying a share link, said in words.
///
/// Anybody else refused gets the bare 401 they always did. A link's holder is
/// told which way it failed — expired, withdrawn, not a link of this server,
/// or a working link asked for a profile it does not open — because the page
/// in front of them has to say one of those, and "sign in" is the wrong answer
/// to all four. The codes are the contract; see <see cref="ShareRefusal"/>.
/// </summary>
internal sealed class ShareRefusalResults : IAuthorizationMiddlewareResultHandler
{
    private readonly AuthorizationMiddlewareResultHandler fallback = new();

    public async Task HandleAsync(
        RequestDelegate next,
        HttpContext context,
        AuthorizationPolicy policy,
        PolicyAuthorizationResult authorizeResult)
    {
        var refusedLink = authorizeResult.Challenged
            && policy.Requirements.OfType<ReaderRequirement>().Any()
            && context.Request.Headers.ContainsKey(ShareAccess.Header);

        if (!refusedLink)
        {
            await fallback.HandleAsync(next, context, policy, authorizeResult);
            return;
        }

        var refusal = context.Items[ShareAccess.RefusalKey] as ShareRefusal ?? ShareRefusal.NotShared;

        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        await context.Response.WriteAsJsonAsync(
            new { error = refusal.Code, message = refusal.Message },
            context.RequestAborted);
    }
}

/// <summary>Opening a read route to outsiders.</summary>
public static class ReaderAccessExtensions
{
    /// <summary>
    /// The reader policy and the outsiders' rate limit, and — given a coverage —
    /// what a share link must open for it to read this route.
    /// </summary>
    public static TBuilder AllowOutsiders<TBuilder>(this TBuilder builder, ShareCoverage? coverage = null)
        where TBuilder : IEndpointConventionBuilder
    {
        ArgumentNullException.ThrowIfNull(builder);

        builder.RequireAuthorization(FoxfirePolicies.Reader).RequireRateLimiting(RateLimits.Reader);
        if (coverage is not null) builder.WithMetadata(coverage);

        return builder;
    }

    public static IServiceCollection AddFoxfireReaderAccess(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddScoped<ShareAccess>();
        services.AddScoped<IAuthorizationHandler, ReaderAuthorizationHandler>();
        services.AddSingleton<IAuthorizationMiddlewareResultHandler, ShareRefusalResults>();
        services.AddAuthorization(options =>
            options.AddPolicy(FoxfirePolicies.Reader, policy => policy.AddRequirements(new ReaderRequirement())));

        return services;
    }
}
