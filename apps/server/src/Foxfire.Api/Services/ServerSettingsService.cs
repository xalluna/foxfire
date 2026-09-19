using Foxfire.Data;
using Foxfire.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Services;

/// <summary>
/// The handful of switches an admin can change without a restart.
///
/// Reads fall back to a default rather than throwing when a key has never been
/// written, so a fresh database behaves like a configured one and seeding is a
/// convenience rather than a precondition.
/// </summary>
public sealed class ServerSettingsService(FoxfireDbContext db, TimeProvider time)
{
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
