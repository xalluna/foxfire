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

    public DbSet<Match> Matches => Set<Match>();
    public DbSet<MatchParticipant> MatchParticipants => Set<MatchParticipant>();
    public DbSet<LeagueEntry> LeagueEntries => Set<LeagueEntry>();
    public DbSet<RankSnapshot> RankSnapshots => Set<RankSnapshot>();
    public DbSet<MatchRank> MatchRanks => Set<MatchRank>();
    public DbSet<ChampionMastery> ChampionMasteries => Set<ChampionMastery>();
    public DbSet<SyncState> SyncStates => Set<SyncState>();
    public DbSet<RetiredPuuid> RetiredPuuids => Set<RetiredPuuid>();
    public DbSet<RankedSeason> Seasons => Set<RankedSeason>();

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

        ConfigureGameData(builder);
    }

    /// <summary>
    /// The shared half of the schema: games, ranks, and how far through fetching
    /// them the server is.
    ///
    /// Everything here is visible to every member, which is why almost none of
    /// it hangs off a Foxfire account. A match belongs to the server, not to a
    /// person; a rank reading belongs to a Riot account, which belongs to at most
    /// one person at a time and outlives whoever currently owns it.
    ///
    /// Ported from the desktop's twelve SQLite migrations, and the indexes are
    /// ported with it rather than guessed at — each of those was added against a
    /// query that was observed to be doing something worse.
    /// </summary>
    private static void ConfigureGameData(ModelBuilder builder)
    {
        builder.Entity<Match>(e =>
        {
            e.HasKey(m => m.MatchId);
            e.Property(m => m.MatchId).HasMaxLength(32);
            e.Property(m => m.GameMode).HasMaxLength(32);
            e.Property(m => m.GameType).HasMaxLength(32);
            e.Property(m => m.PlatformId).HasMaxLength(8);

            // nvarchar(max). A match payload is 100-200 KB of UTF-16 once SQL
            // Server has it, and there is no length short of max that would not
            // eventually truncate one.
            e.Property(m => m.RawJson).IsRequired();

            // History pages walk backwards through time.
            e.HasIndex(m => m.GameCreation);

            // For attribution, which looks up the ranked games between two
            // readings and has no player-shaped entry point to start from. The
            // match list and champion stats deliberately do NOT use it — both
            // start from a participant row and reach the match by key, which is
            // already the better plan.
            e.HasIndex(m => m.QueueId);
        });

        builder.Entity<MatchParticipant>(e =>
        {
            // The desktop carries a surrogate key here plus a unique constraint
            // on this pair. The key was never used for anything, so the
            // constraint is simply the key.
            e.HasKey(p => new { p.MatchId, p.Puuid });

            e.Property(p => p.MatchId).HasMaxLength(32);
            e.Property(p => p.Puuid).HasMaxLength(78);
            e.Property(p => p.GameName).HasMaxLength(64);
            e.Property(p => p.TagLine).HasMaxLength(16);
            e.Property(p => p.ChampionName).HasMaxLength(32);
            e.Property(p => p.TeamPosition).HasMaxLength(16);
            e.Property(p => p.ItemsJson).HasMaxLength(256);
            e.Property(p => p.PerksJson).HasMaxLength(2048);

            e.HasOne(p => p.Match)
                .WithMany(m => m.Participants)
                .HasForeignKey(p => p.MatchId)
                .OnDelete(DeleteBehavior.Cascade);

            // Every screen that is about one player starts here.
            e.HasIndex(p => p.Puuid);

            // Team totals — kills, damage share — are aggregated per match on
            // every page of history, and without this the join degrades to a
            // scan of the whole table.
            e.HasIndex(p => new { p.MatchId, p.TeamId });

            // Champion stats and attribution both filter remakes out, and the
            // column is overwhelmingly false, so this keeps them from
            // re-scanning to find the handful that are not.
            e.HasIndex(p => new { p.Puuid, p.GameEndedInEarlySurrender });
        });

        builder.Entity<LeagueEntry>(e =>
        {
            e.HasKey(l => new { l.RiotAccountId, l.QueueType });
            e.Property(l => l.QueueType).HasMaxLength(32);
            e.Property(l => l.Tier).HasMaxLength(16);
            e.Property(l => l.Division).HasMaxLength(4);

            e.HasOne(l => l.RiotAccount)
                .WithMany()
                .HasForeignKey(l => l.RiotAccountId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<RankSnapshot>(e =>
        {
            e.HasKey(r => r.Id);
            e.Property(r => r.QueueType).HasMaxLength(32);
            e.Property(r => r.Tier).HasMaxLength(16);
            e.Property(r => r.Division).HasMaxLength(4);
            e.Property(r => r.Source).HasMaxLength(16).IsRequired();
            e.Property(r => r.MatchId).HasMaxLength(32);

            e.HasOne(r => r.RiotAccount)
                .WithMany()
                .HasForeignKey(r => r.RiotAccountId)
                .OnDelete(DeleteBehavior.Cascade);

            // A manual edit names the game it describes. Cascade would be wrong
            // here and is not merely unnecessary: SQL Server refuses a second
            // cascade path into this table anyway, since the account already has
            // one, so deleting a match clears the link and leaves the reading.
            e.HasOne(r => r.Match)
                .WithMany()
                .HasForeignKey(r => r.MatchId)
                .OnDelete(DeleteBehavior.ClientSetNull);

            // Every read walks one account's readings for one queue in time
            // order. This is the index attribution lives on, and Id is on the
            // end of it because the walk is over adjacent pairs: two readings
            // sharing a millisecond have to come back in the same order every
            // time, or the pair between them changes.
            e.HasIndex(r => new { r.RiotAccountId, r.QueueType, r.CapturedAt, r.Id });

            // Clearing a manual edit is a targeted delete by match.
            e.HasIndex(r => r.MatchId);
        });

        builder.Entity<MatchRank>(e =>
        {
            e.HasKey(r => new { r.MatchId, r.RiotAccountId });
            e.Property(r => r.MatchId).HasMaxLength(32);
            e.Property(r => r.QueueType).HasMaxLength(32);
            e.Property(r => r.TierBefore).HasMaxLength(16);
            e.Property(r => r.DivisionBefore).HasMaxLength(4);
            e.Property(r => r.TierAfter).HasMaxLength(16);
            e.Property(r => r.DivisionAfter).HasMaxLength(4);

            e.HasOne(r => r.Match)
                .WithMany()
                .HasForeignKey(r => r.MatchId)
                .OnDelete(DeleteBehavior.Cascade);

            // ClientSetNull rather than Cascade: SQL Server allows only one
            // cascade path between a pair of tables, and the match already has
            // it. Deleting an account is rare and goes through EF, which clears
            // these first; the rows are derived and a lost one costs an
            // attribution pass.
            e.HasOne(r => r.RiotAccount)
                .WithMany()
                .HasForeignKey(r => r.RiotAccountId)
                .OnDelete(DeleteBehavior.ClientSetNull);
        });

        builder.Entity<ChampionMastery>(e =>
        {
            e.HasKey(m => new { m.RiotAccountId, m.ChampionId });

            e.HasOne(m => m.RiotAccount)
                .WithMany()
                .HasForeignKey(m => m.RiotAccountId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<SyncState>(e =>
        {
            e.HasKey(s => s.RiotAccountId);
            e.Property(s => s.MostRecentMatchId).HasMaxLength(32);

            e.HasOne(s => s.RiotAccount)
                .WithMany()
                .HasForeignKey(s => s.RiotAccountId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<RetiredPuuid>(e =>
        {
            e.HasKey(r => new { r.RiotAccountId, r.Puuid });
            e.Property(r => r.Puuid).HasMaxLength(78);

            e.HasOne(r => r.RiotAccount)
                .WithMany()
                .HasForeignKey(r => r.RiotAccountId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<RankedSeason>(e =>
        {
            e.HasKey(s => s.Id);
            e.Property(s => s.Label).HasMaxLength(64).IsRequired();

            // Two seasons opening at the same instant has no meaning and would
            // make the ordering — which is the whole of how a season is read —
            // ambiguous.
            e.HasIndex(s => s.StartsAt).IsUnique();
        });
    }
}
