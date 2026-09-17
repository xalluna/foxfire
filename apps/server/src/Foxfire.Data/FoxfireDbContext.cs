using Foxfire.Data.Entities;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace Foxfire.Data;

/// <summary>
/// Everything this server stores.
///
/// Identity brings its own seven tables for users, roles, claims and logins;
/// what is added here is the handful of things Foxfire is actually about.
/// Matches, rank snapshots and LP arrive in Phase 2 — this is the shape that
/// lets somebody register, sign in, and say which League accounts are theirs.
///
/// Guid keys throughout, generated as version 7 so they sort by creation time.
/// That is not cosmetic on SQL Server: a clustered primary key on a random Guid
/// scatters inserts across the whole index and fragments it, and every table
/// here is insert-heavy in exactly the way that punishes.
/// </summary>
public sealed class FoxfireDbContext(DbContextOptions<FoxfireDbContext> options)
    : IdentityDbContext<FoxfireUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<RiotAccount> RiotAccounts => Set<RiotAccount>();
    public DbSet<ServerSetting> ServerSettings => Set<ServerSetting>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<FoxfireUser>(e =>
        {
            e.ToTable("Users");
            e.Property(u => u.CreatedAt).IsRequired();
        });

        builder.Entity<IdentityRole<Guid>>(e => e.ToTable("Roles"));
        builder.Entity<IdentityUserRole<Guid>>(e => e.ToTable("UserRoles"));
        builder.Entity<IdentityUserClaim<Guid>>(e => e.ToTable("UserClaims"));
        builder.Entity<IdentityUserLogin<Guid>>(e => e.ToTable("UserLogins"));
        builder.Entity<IdentityUserToken<Guid>>(e => e.ToTable("UserTokens"));
        builder.Entity<IdentityRoleClaim<Guid>>(e => e.ToTable("RoleClaims"));

        builder.Entity<RefreshToken>(e =>
        {
            e.HasKey(t => t.Id);

            // The lookup key, so it is indexed — and unique, because two live
            // sessions hashing to one row would mean a collision nobody would
            // ever diagnose.
            e.Property(t => t.TokenHash).HasMaxLength(32).IsRequired();
            e.HasIndex(t => t.TokenHash).IsUnique();

            e.Property(t => t.DeviceLabel).HasMaxLength(128);

            // Signing out everywhere, and deleting an account, both mean every
            // session goes with it. Nothing outside the session refers to these.
            e.HasOne(t => t.User)
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            // The sweep that clears dead sessions reads exactly this.
            e.HasIndex(t => new { t.UserId, t.ExpiresAt });
        });

        builder.Entity<Invite>(e =>
        {
            e.HasKey(i => i.Id);
            e.Property(i => i.Email).HasMaxLength(256).IsRequired();

            // The admin list opens on outstanding invites for an address, and
            // registration looks one up by the email it was offered.
            e.HasIndex(i => i.Email);

            // Deleting an admin must not take their invites with them, and
            // deleting somebody must not delete the record of how they got in.
            e.HasOne(i => i.CreatedBy)
                .WithMany()
                .HasForeignKey(i => i.CreatedByUserId)
                .OnDelete(DeleteBehavior.SetNull);

            // ClientSetNull, not SetNull, and that is forced rather than chosen.
            // SQL Server refuses two cascading paths between the same pair of
            // tables (error 1785), and CreatedBy already has the one. So EF nulls
            // this in memory when a tracked user is deleted and the constraint
            // itself is NO ACTION.
            //
            // Nothing is lost by it: whether an invite was spent is RedeemedAt,
            // which is never cleared. This column only says who, and "an account
            // that no longer exists" is a fair answer.
            e.HasOne(i => i.RedeemedBy)
                .WithMany()
                .HasForeignKey(i => i.RedeemedByUserId)
                .OnDelete(DeleteBehavior.ClientSetNull);

            // Not unique. A unique index here would say one person may only ever
            // redeem one invite, which is a different rule and not one anybody
            // asked for — somebody who leaves and is invited back should be able
            // to. What makes an invite single-use is the conditional UPDATE on
            // RedeemedAt in the registration transaction.
            e.HasIndex(i => i.RedeemedByUserId);
        });

        builder.Entity<RiotAccount>(e =>
        {
            e.HasKey(a => a.Id);

            e.Property(a => a.Puuid).HasMaxLength(78).IsRequired();
            e.HasIndex(a => a.Puuid).IsUnique();

            e.Property(a => a.GameName).HasMaxLength(64).IsRequired();
            e.Property(a => a.TagLine).HasMaxLength(16).IsRequired();
            e.Property(a => a.Platform).HasMaxLength(8).IsRequired();
            e.Property(a => a.RegionalRoute).HasMaxLength(16).IsRequired();
            e.Property(a => a.SummonerId).HasMaxLength(64);

            // The identity that survives a key change, and what a link request
            // arrives as. Case-insensitive already, since SQL Server's default
            // collation is — Riot IDs are not case-sensitive either.
            e.HasIndex(a => new { a.GameName, a.TagLine }).IsUnique();

            // At most one owner is guaranteed by this being a column rather than
            // a join. SET NULL because deleting a person releases their claim;
            // it does not delete a League account or the games played on it.
            e.HasOne(a => a.Owner)
                .WithMany(u => u.RiotAccounts)
                .HasForeignKey(a => a.OwnerId)
                .OnDelete(DeleteBehavior.SetNull);

            e.HasIndex(a => a.OwnerId);

            e.Ignore(a => a.RiotId);
        });

        builder.Entity<ServerSetting>(e =>
        {
            e.HasKey(s => s.Key);
            e.Property(s => s.Key).HasMaxLength(64);
            e.Property(s => s.Value).HasMaxLength(512).IsRequired();
        });
    }
}
