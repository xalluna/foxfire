using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Foxfire.Data.Entities;

/// <summary>
/// One profile, opened to whoever holds the link, for a week.
///
/// The half of a share link that remembers, as <see cref="Invite"/> is for an
/// invite: the travelling half is a signed token naming this row (see
/// Foxfire.Core.ShareToken), and this row is what says which Riot account it
/// opens and whether somebody has withdrawn it since. The account is here
/// rather than in the token so that the token says nothing about whose profile
/// it is to anybody who only has the URL.
///
/// It opens the account, not a page: the League and TFT profiles, both rank
/// pages, champions, and the games in its history. Anybody else — a teammate on
/// a scoreboard — stays behind sign-in. Reading is all it opens; nothing that
/// writes, spends the Riot key or downloads a replay is reachable with one.
///
/// Kept after it lapses or is revoked rather than deleted, so a link opened late
/// can say what happened to it rather than look forged.
/// </summary>
public sealed class ShareLink
{
    public Guid Id { get; set; }

    /// <summary>The account it opens.</summary>
    public Guid RiotAccountId { get; set; }
    public RiotAccount? RiotAccount { get; set; }

    /// <summary>The member who shared it. Deleting them withdraws what they shared.</summary>
    public Guid CreatedByUserId { get; set; }
    public FoxfireUser? CreatedBy { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }

    /// <summary>Set when its creator or an admin withdraws it.</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    public bool IsOpen(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;

    /// <summary>
    /// <see cref="IsOpen"/>, as something a query can hand to SQL Server. The
    /// two must say the same thing.
    /// </summary>
    public static Expression<Func<ShareLink, bool>> OpenAt(DateTimeOffset now) =>
        s => s.RevokedAt == null && s.ExpiresAt > now;
}

internal sealed class ShareLinkConfiguration : IEntityTypeConfiguration<ShareLink>
{
    public void Configure(EntityTypeBuilder<ShareLink> builder)
    {
        builder.HasKey(s => s.Id);

        builder.HasOne(s => s.RiotAccount)
            .WithMany()
            .HasForeignKey(s => s.RiotAccountId)
            .OnDelete(DeleteBehavior.Cascade);

        // A link is something its member is vouching for, and an account that
        // has gone cannot vouch for anything.
        builder.HasOne(s => s.CreatedBy)
            .WithMany()
            .HasForeignKey(s => s.CreatedByUserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Sharing a profile again hands back the link the same member made for
        // it a moment ago, which looks it up by the pair.
        builder.HasIndex(s => new { s.RiotAccountId, s.CreatedByUserId });

        // The admin list is the open ones, newest first.
        builder.HasIndex(s => s.ExpiresAt);
    }
}
