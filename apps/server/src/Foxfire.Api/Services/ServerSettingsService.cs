using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace Foxfire.Api.Services;

/// <summary>
/// The handful of switches an admin can change without a restart.
///
/// Reads fall back to a default rather than throwing when a key has never been
/// written, so a fresh database behaves like a configured one and seeding is a
/// convenience rather than a precondition.
/// </summary>
public sealed class ServerSettingsService(FoxfireDbContext db, TimeProvider time, IMemoryCache cache)
{
    /// <summary>
    /// Off unless somebody has turned it on. See <see cref="ServerSettingKeys.PublicAccess"/>.
    /// </summary>
    public const bool PublicAccessDefault = false;

    /// <summary>
    /// How long one process trusts its last reading of <see cref="ServerSettingKeys.PublicAccess"/>.
    ///
    /// The reader policy asks on every request without a member's token, which
    /// on an open server is most of them, and every other setting here is a
    /// query. Turning it off in this process is immediate, because the write
    /// drops the reading; another process overlapping a deploy catches up
    /// within this.
    /// </summary>
    public static readonly TimeSpan PublicAccessCacheLifetime = TimeSpan.FromSeconds(15);

    private const string PublicAccessCacheKey = "settings:" + ServerSettingKeys.PublicAccess;

    /// <summary>
    /// On unless somebody has turned it off.
    ///
    /// A community server nobody can join is the less useful way to be wrong by
    /// accident, and the admin account is seeded from configuration, so an open
    /// server is never also an unclaimed one.
    /// </summary>
    public const bool PublicSignupDefault = true;

    /// <summary>
    /// How many matches a newly linked account backfills.
    ///
    /// The desktop's figure, kept as the default so a server behaves like the
    /// app it replaces. A host sharing one personal key across ten people will
    /// want it lower: this is roughly one Riot request per match, out of about
    /// a hundred every two minutes for the whole server.
    /// </summary>
    public const int BackfillTargetDefault = 200;

    public async Task<bool> IsPublicSignupEnabledAsync(CancellationToken cancellationToken = default)
    {
        var raw = await ReadAsync(ServerSettingKeys.PublicSignup, cancellationToken);
        return raw is null ? PublicSignupDefault : raw == "true";
    }

    public Task SetPublicSignupAsync(bool enabled, CancellationToken cancellationToken = default) =>
        WriteAsync(ServerSettingKeys.PublicSignup, enabled ? "true" : "false", cancellationToken);

    public async Task<bool> IsPublicAccessEnabledAsync(CancellationToken cancellationToken = default)
    {
        if (cache.TryGetValue(PublicAccessCacheKey, out bool cached)) return cached;

        var raw = await ReadAsync(ServerSettingKeys.PublicAccess, cancellationToken);
        var enabled = raw is null ? PublicAccessDefault : raw == "true";

        cache.Set(PublicAccessCacheKey, enabled, PublicAccessCacheLifetime);
        return enabled;
    }

    public async Task SetPublicAccessAsync(bool enabled, CancellationToken cancellationToken = default)
    {
        await WriteAsync(ServerSettingKeys.PublicAccess, enabled ? "true" : "false", cancellationToken);
        cache.Remove(PublicAccessCacheKey);
    }

    public Task SetBackfillTargetAsync(int matches, CancellationToken cancellationToken = default) =>
        WriteAsync(ServerSettingKeys.BackfillTarget, matches.ToString(System.Globalization.CultureInfo.InvariantCulture), cancellationToken);

    /// <summary>
    /// How much of the blob store replays may take, in bytes. Zero means no cap.
    ///
    /// Uncapped by default, because a cap nobody chose is a cap that surprises
    /// somebody — and the failure it prevents is an upload being refused, which
    /// is exactly what the cap itself does. What it buys a host is choosing
    /// *when* that starts happening, rather than finding out from their storage
    /// bill or a full volume.
    /// </summary>
    public const long ReplayByteCapDefault = 0;

    public Task SetReplayByteCapAsync(long bytes, CancellationToken cancellationToken = default) =>
        WriteAsync(ServerSettingKeys.ReplayByteCap, bytes.ToString(System.Globalization.CultureInfo.InvariantCulture), cancellationToken);

    public async Task<long> GetReplayByteCapAsync(CancellationToken cancellationToken = default)
    {
        var raw = await ReadAsync(ServerSettingKeys.ReplayByteCap, cancellationToken);
        return long.TryParse(raw, out var value) && value >= 0 ? value : ReplayByteCapDefault;
    }

    public async Task<int> GetBackfillTargetAsync(CancellationToken cancellationToken = default)
    {
        var raw = await ReadAsync(ServerSettingKeys.BackfillTarget, cancellationToken);
        return int.TryParse(raw, out var value) && value > 0 ? value : BackfillTargetDefault;
    }

    /// <summary>
    /// How many TFT matches a newly linked account backfills — the same default
    /// as League's, and a setting of its own, because a host whose community
    /// barely plays TFT may well want to spend less of the key on it.
    /// </summary>
    public async Task<int> GetTftBackfillTargetAsync(CancellationToken cancellationToken = default)
    {
        var raw = await ReadAsync(ServerSettingKeys.TftBackfillTarget, cancellationToken);
        return int.TryParse(raw, out var value) && value > 0 ? value : BackfillTargetDefault;
    }

    public Task SetTftBackfillTargetAsync(int matches, CancellationToken cancellationToken = default) =>
        WriteAsync(ServerSettingKeys.TftBackfillTarget, matches.ToString(System.Globalization.CultureInfo.InvariantCulture), cancellationToken);

    /// <summary>One game's backfill target.</summary>
    public Task<int> GetBackfillTargetAsync(Foxfire.Core.Game game, CancellationToken cancellationToken = default) =>
        game == Foxfire.Core.Game.Tft
            ? GetTftBackfillTargetAsync(cancellationToken)
            : GetBackfillTargetAsync(cancellationToken);

    /// <summary>
    /// The attribution rule the stored LP figures were built under.
    ///
    /// 1 when never written: every server from before the rule had a number
    /// worked its figures out under the first one.
    /// </summary>
    public async Task<int> GetAttributionRuleAsync(CancellationToken cancellationToken = default)
    {
        var raw = await ReadAsync(ServerSettingKeys.AttributionRule, cancellationToken);
        return int.TryParse(raw, out var value) && value > 0 ? value : 1;
    }

    public Task SetAttributionRuleAsync(int rule, CancellationToken cancellationToken = default) =>
        WriteAsync(ServerSettingKeys.AttributionRule, rule.ToString(System.Globalization.CultureInfo.InvariantCulture), cancellationToken);

    private async Task<string?> ReadAsync(string key, CancellationToken cancellationToken)
    {
        var value = await db.ServerSettings
            .Where(s => s.Key == key)
            .Select(s => s.Value)
            .FirstOrDefaultAsync(cancellationToken);

        // Empty means cleared, never "unset" — the same rule the desktop's
        // app_settings follows, so the two cannot disagree about what a blank
        // row means.
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private async Task WriteAsync(string key, string value, CancellationToken cancellationToken)
    {
        var existing = await db.ServerSettings.FirstOrDefaultAsync(s => s.Key == key, cancellationToken);
        var now = time.GetUtcNow();

        if (existing is null)
        {
            db.ServerSettings.Add(new ServerSetting { Key = key, Value = value, UpdatedAt = now });
        }
        else
        {
            existing.Value = value;
            existing.UpdatedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }
}
