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
///
/// Guid keys throughout, generated as version 7 so they sort by creation time.
/// That is not cosmetic on SQL Server: a clustered primary key on a random Guid
/// scatters inserts across the whole index and fragments it, and every table
/// here is insert-heavy in exactly the way that punishes.
///
/// There is no configuration in this file. Each entity carries its own, as an
/// <see cref="IEntityTypeConfiguration{TEntity}"/> in the file that declares it,
/// so the reason a column is the width it is sits beside the property rather
/// than three hundred lines away from it. They are found by assembly scan.
/// </summary>
public sealed class FoxfireDbContext(DbContextOptions<FoxfireDbContext> options)
    : IdentityDbContext<FoxfireUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Invite> Invites => Set<Invite>();
    public DbSet<PasswordReset> PasswordResets => Set<PasswordReset>();
    public DbSet<RiotAccount> RiotAccounts => Set<RiotAccount>();
    public DbSet<ServerSetting> ServerSettings => Set<ServerSetting>();

    // The shared half of the schema: games, ranks, and how far through fetching
    // them the server is.
    //
    // Everything below is visible to every member, which is why almost none of
    // it hangs off a Foxfire account. A match belongs to the server, not to a
    // person; a rank reading belongs to a Riot account, which belongs to at most
    // one person at a time and outlives whoever currently owns it.
    //
    // Ported from the desktop's twelve SQLite migrations, and the indexes are
    // ported with it rather than guessed at — each of those was added against a
    // query that was observed to be doing something worse.
    public DbSet<Match> Matches => Set<Match>();
    public DbSet<MatchParticipant> MatchParticipants => Set<MatchParticipant>();
    public DbSet<LeagueEntry> LeagueEntries => Set<LeagueEntry>();
    public DbSet<RankSnapshot> RankSnapshots => Set<RankSnapshot>();
    public DbSet<MatchRank> MatchRanks => Set<MatchRank>();
    public DbSet<ChampionMastery> ChampionMasteries => Set<ChampionMastery>();
    public DbSet<SyncState> SyncStates => Set<SyncState>();
    public DbSet<RetiredPuuid> RetiredPuuids => Set<RetiredPuuid>();
    public DbSet<RankedSeason> Seasons => Set<RankedSeason>();
    public DbSet<SharedReplay> SharedReplays => Set<SharedReplay>();
    public DbSet<MatchRecording> MatchRecordings => Set<MatchRecording>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        // Every IEntityTypeConfiguration in Foxfire.Data, which is all of them.
        // Adding an entity means adding its configuration beside it and nothing
        // here — and forgetting the configuration shows up as a migration that
        // wants to build a table nobody described.
        builder.ApplyConfigurationsFromAssembly(typeof(FoxfireDbContext).Assembly);
    }
}
