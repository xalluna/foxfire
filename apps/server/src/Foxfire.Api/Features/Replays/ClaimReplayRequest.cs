using System.Net;
using FluentValidation;
using Foxfire.Api.Common;
using Foxfire.Api.Services;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Storage;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Api.Features.Replays;

/// <summary>What the desktop knows about a .rofl before it uploads one.</summary>
public sealed record ClaimReplayRequest(
    string MatchId,
    string? GameVersion,
    string? Patch,
    int? DurationSeconds,
    long FileBytes) : IValidatedRequest<ReplayUploadGrant>;

/// <summary>Permission to upload, and where to put it.</summary>
public sealed record ReplayUploadGrant(string MatchId, string UploadUrl, DateTimeOffset ExpiresAt);

internal sealed class ClaimReplayRequestValidator : AbstractValidator<ClaimReplayRequest>
{
    public ClaimReplayRequestValidator() =>
        RuleFor(x => (x.MatchId ?? string.Empty).Trim())
            .NotEmpty()
            .WithErrorCode("invalid_match")
            .WithMessage("A replay has to name the game it is of.");
}

/// <summary>
/// Asks for the right to upload one game's replay.
///
/// Answers 409 when somebody else already holds it — which is the ordinary
/// outcome for nine of the ten people in a game, and not a failure. The desktop
/// treats it as "already covered" and moves on.
/// </summary>
internal sealed class ClaimReplayRequestHandler(
    FoxfireDbContext db,
    IIdentityContext me,
    IReplayStorage storage,
    ServerSettingsService settings,
    TimeProvider time,
    ILogger<ClaimReplayRequestHandler> logger)
    : IValidatedRequestHandler<ClaimReplayRequest, ReplayUploadGrant>
{
    private static Response<ReplayUploadGrant> NotOffered() =>
        Response<ReplayUploadGrant>.Failure(Replays.NotOffered, Replays.NotOfferedStatus);

    private static Response<ReplayUploadGrant> Conflict(string code, string message) =>
        Response<ReplayUploadGrant>.Failure(new Error(code, message), HttpStatusCode.Conflict);

    public async Task<Response<ReplayUploadGrant>> Handle(
        ClaimReplayRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        if (!storage.IsConfigured) return NotOffered();

        if (me.UserId is not { } userId)
        {
            return Response<ReplayUploadGrant>.Failure(
                new Error("unauthenticated", "Sign in again."), HttpStatusCode.Unauthorized);
        }

        var matchId = (request.MatchId ?? "").Trim();

        // Checked before the claim rather than after the upload, so a refused
        // replay costs a request rather than thirty megabytes of somebody's
        // upstream. Against what the rows say rather than what the store says:
        // this runs on every claim, and listing a container of thousands of
        // blobs to answer it would make the common case pay for the rare one.
        var cap = await settings.GetReplayByteCapAsync(cancellationToken);
        if (cap > 0)
        {
            var held = await db.SharedReplays
                .Where(r => r.UploadedAt != null)
                .SumAsync(r => (long?)r.FileBytes, cancellationToken) ?? 0;

            if (held + Math.Max(request.FileBytes, 0) > cap)
            {
                return Response<ReplayUploadGrant>.Failure(
                    new Error(
                        "storage_full",
                        "This server has reached the storage its administrator set aside for replays. "
                        + "Everything already uploaded still works."),
                    HttpStatusCode.InsufficientStorage);
            }
        }

        var now = time.GetUtcNow();
        var existing = await db.SharedReplays.FirstOrDefaultAsync(r => r.MatchId == matchId, cancellationToken);

        if (existing is not null)
        {
            if (existing.UploadedAt is not null)
            {
                return Conflict("already_uploaded", "This server already has that replay.");
            }

            if (now - existing.ClaimedAt < Replays.ClaimLifetime && existing.UploadedByUserId != userId)
            {
                return Conflict("claimed", "Somebody else is uploading that replay.");
            }

            // Either it is this caller's own claim being retried, or the
            // previous one went stale. Both are taken over rather than refused.
            existing.UploadedByUserId = userId;
            existing.ClaimedAt = now;
            existing.GameVersion = request.GameVersion;
            existing.Patch = request.Patch;
            existing.DurationSeconds = request.DurationSeconds;
        }
        else
        {
            db.SharedReplays.Add(new SharedReplay
            {
                MatchId = matchId,
                GameVersion = request.GameVersion,
                Patch = request.Patch,
                DurationSeconds = request.DurationSeconds,
                UploadedByUserId = userId,
                ClaimedAt = now
            });
        }

        StorageGrant grant;
        try
        {
            grant = await storage.GrantUploadAsync(matchId, cancellationToken);
        }
        catch (ReplayStorageException ex)
        {
            logger.LogError(ex, "Could not mint an upload URL for {MatchId}", matchId);
            return NotOffered();
        }

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two people claiming an unclaimed match at the same instant. The
            // primary key decides; the loser is told the truth.
            return Conflict("claimed", "Somebody else just claimed that replay.");
        }

        return new ReplayUploadGrant(matchId, grant.Url.ToString(), grant.ExpiresAt);
    }
}
