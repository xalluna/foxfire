using System.Net.Http.Json;
using Foxfire.Api.Common;
using Foxfire.Api.Features.Storage;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.Extensions.DependencyInjection;

namespace Foxfire.Api.Tests;

/// <summary>
/// The replay library, as an admin pages through it looking for space.
///
/// The server is shared across the assembly, so the rows here are written
/// straight to the table at sizes nothing real would have — a petabyte and up —
/// which puts them at the head of a largest-first list whatever else is in it.
/// </summary>
[Collection(FoxfireServerCollection.Name)]
public class AdminStorageTests(FoxfireServerFixture server)
{
    private const long Huge = 1L << 50;

    private async Task<string> SeedAsync(long fileBytes, bool uploaded = true)
    {
        await using var scope = server.Factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var now = DateTimeOffset.UtcNow;
        var replay = new SharedReplay
        {
            MatchId = $"NA1_{Random.Shared.NextInt64(1, long.MaxValue)}",
            BlobKey = uploaded ? $"replays/{Guid.NewGuid():N}.rofl" : null,
            FileBytes = fileBytes,
            Patch = "15.14",
            ClaimedAt = now,
            UploadedAt = uploaded ? now : null
        };

        db.SharedReplays.Add(replay);
        await db.SaveChangesAsync();
        return replay.MatchId;
    }

    private static async Task<Page<AdminReplayResponse>> PageAsync(HttpClient admin, string query = "") =>
        (await admin.GetFromJsonAsync<Page<AdminReplayResponse>>(
            new Uri($"/api/admin/storage/replays?{query}", UriKind.Relative)))!;

    [Fact]
    public async Task The_library_pages_largest_first_with_a_total()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        var smallest = await SeedAsync(Huge + 1);
        var middle = await SeedAsync(Huge + 2);
        var largest = await SeedAsync(Huge + 3);

        var first = await PageAsync(admin, "limit=2");
        var second = await PageAsync(admin, "limit=2&offset=2");

        Assert.Equal(new[] { largest, middle }, first.Items.Select(r => r.MatchId));
        Assert.Equal(smallest, second.Items[0].MatchId);
        Assert.True(first.Total >= 3);
        Assert.Equal(first.Total, second.Total);
    }

    [Fact]
    public async Task An_upload_that_never_finished_is_not_in_the_library()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        // Bigger than anything else here, so it would lead the list if it counted.
        var abandoned = await SeedAsync(Huge * 4, uploaded: false);

        var page = await PageAsync(admin);

        Assert.DoesNotContain(page.Items, r => r.MatchId == abandoned);
    }

    [Fact]
    public async Task No_page_of_the_library_is_bigger_than_the_cap()
    {
        var (admin, _) = await server.AdminAsync();
        using var _admin = admin;

        await SeedAsync(Huge);

        var page = await PageAsync(admin, "limit=100000");

        Assert.True(page.Items.Count <= PageRequest.MaxLimit);
        Assert.NotEmpty(page.Items);
    }
}
