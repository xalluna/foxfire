using System.Net;
using System.Net.Http.Json;
using Foxfire.Api.Features.RiotAccounts;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// Reading accounts one question at a time: yours, one by id, one by Riot ID.
///
/// These replaced a single read of every account on the server, which each
/// client held and searched for whatever it needed. The server is shared across
/// the assembly, so every test here names its own accounts and ignores the rest.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AccountReadTests(FoxfireServerFixture server)
{
    private static string Stem() => Guid.NewGuid().ToString("N")[..8];

    /// <summary>A tracked account, unclaimed unless somebody is named.</summary>
    private async Task<RiotAccount> TrackAsync(string gameName, string tagLine = "NA1", Guid? ownerId = null)
    {
        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var now = DateTimeOffset.UtcNow;

        var account = new RiotAccount
        {
            Id = Guid.CreateVersion7(now),
            Puuid = $"puuid-{Guid.NewGuid():N}",
            GameName = gameName,
            TagLine = tagLine,
            Platform = "na1",
            RegionalRoute = "americas",
            OwnerId = ownerId,
            LinkedAt = ownerId is null ? null : now,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.RiotAccounts.Add(account);
        await db.SaveChangesAsync();
        return account;
    }

    /// <summary>A freshly registered member, signed in on their own client.</summary>
    private async Task<(HttpClient Client, Session Session)> MemberAsync()
    {
        var client = server.Client();
        var stem = Stem();
        var session = await server.RegisterAsync(client, $"Reader{stem}", $"reader-{stem}@example.com");
        FoxfireServerFixture.Authenticated(client, session);
        return (client, session);
    }

    [Fact]
    public async Task Mine_is_the_accounts_the_caller_claimed_and_nobody_elses()
    {
        var (client, session) = await MemberAsync();
        using var _client = client;
        var (other, otherSession) = await MemberAsync();
        other.Dispose();

        var stem = Stem();
        var first = await TrackAsync($"Main{stem}", ownerId: session.User.Id);
        var second = await TrackAsync($"Alt{stem}", ownerId: session.User.Id);
        await TrackAsync($"Theirs{stem}", ownerId: otherSession.User.Id);
        await TrackAsync($"Nobodys{stem}");

        var mine = await client.GetFromJsonAsync<IReadOnlyList<RiotAccountResponse>>(
            new Uri("/api/riot-accounts/mine", UriKind.Relative));

        // Exactly the two, and in name order. A fresh member has claimed
        // nothing else, so unlike search this can count — and an unclaimed
        // account turning up here is the null-owner mistake it guards against.
        Assert.NotNull(mine);
        Assert.Equal(new[] { second.Id, first.Id }, mine.Select(a => a.Id));
        Assert.All(mine, a => Assert.True(a.IsMine));
    }

    [Fact]
    public async Task An_account_is_read_by_its_id_whoever_owns_it()
    {
        var (client, _) = await MemberAsync();
        using var _client = client;
        var (other, otherSession) = await MemberAsync();
        other.Dispose();

        var theirs = await TrackAsync($"Friend{Stem()}", ownerId: otherSession.User.Id);

        var read = await client.GetFromJsonAsync<RiotAccountResponse>(
            new Uri($"/api/riot-accounts/{theirs.Id}", UriKind.Relative));

        // Everybody's history is everybody's to read; only the flag says whose.
        Assert.NotNull(read);
        Assert.Equal(theirs.Id, read.Id);
        Assert.False(read.IsMine);
        Assert.Equal(otherSession.User.Username, read.OwnerUsername);
    }

    [Fact]
    public async Task An_id_nobody_has_is_not_found()
    {
        var (client, _) = await MemberAsync();
        using var _client = client;

        var response = await client.GetAsync(new Uri($"/api/riot-accounts/{Guid.NewGuid()}", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_riot_id_finds_its_account_however_it_is_capitalised()
    {
        var (client, _) = await MemberAsync();
        using var _client = client;

        var stem = Stem();
        var account = await TrackAsync($"Lookup{stem}", "EUW");

        // A link names a player the way somebody typed it, and the League
        // client the way Riot spells it. Both have to land on one row.
        foreach (var (gameName, tagLine) in new[]
                 {
                     ($"Lookup{stem}", "EUW"),
                     ($"LOOKUP{stem.ToUpperInvariant()}", "euw"),
                     ($"lookup{stem}", "#EUW")
                 })
        {
            var found = await client.GetFromJsonAsync<RiotAccountResponse>(new Uri(
                $"/api/riot-accounts/lookup?gameName={Uri.EscapeDataString(gameName)}&tagLine={Uri.EscapeDataString(tagLine)}",
                UriKind.Relative));

            Assert.Equal(account.Id, found?.Id);
        }
    }

    [Fact]
    public async Task A_riot_id_nobody_plays_as_is_not_found_and_half_of_one_is_refused()
    {
        var (client, _) = await MemberAsync();
        using var _client = client;

        var missing = await client.GetAsync(
            new Uri($"/api/riot-accounts/lookup?gameName=Nobody{Stem()}&tagLine=NA1", UriKind.Relative));

        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);

        var half = await client.GetAsync(new Uri("/api/riot-accounts/lookup?gameName=Faker", UriKind.Relative));
        var error = await half.Content.ReadFromJsonAsync<ApiError>();

        Assert.Equal(HttpStatusCode.BadRequest, half.StatusCode);
        Assert.Equal("invalid_riot_id", error?.Error);
    }

    [Theory]
    [InlineData("/api/riot-accounts/mine")]
    [InlineData("/api/riot-accounts/lookup?gameName=Faker&tagLine=KR")]
    [InlineData("/api/riot-accounts/0197a3c4-0000-7000-8000-000000000000")]
    public async Task Every_read_still_needs_somebody_signed_in(string path)
    {
        using var client = server.Client();

        var response = await client.GetAsync(new Uri(path, UriKind.Relative));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
