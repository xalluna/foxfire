using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <summary>
    /// TFT arrives as a second game: matches, seasons and syncs say whose they
    /// are, a TFT board has a table of its own, Hyper Roll's rated ladder has
    /// columns, and an account can hold a puuid under a TFT key.
    ///
    /// Every new column that cannot be null defaults to League — or, for a
    /// retired puuid, to the main key — because that is what every existing row
    /// is. EF would have defaulted them to the empty string, which no reader
    /// recognises; the defaults live here rather than in the model so that
    /// nothing writing a row through EF ever leans on them.
    /// </summary>
    public partial class Games : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_SyncStates",
                table: "SyncStates");

            migrationBuilder.DropIndex(
                name: "IX_Seasons_StartsAt",
                table: "Seasons");

            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "SyncStates",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "lol");

            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "Seasons",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "lol");

            migrationBuilder.AddColumn<string>(
                name: "Scope",
                table: "RetiredPuuids",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "main");

            migrationBuilder.AddColumn<int>(
                name: "RatedRating",
                table: "RankSnapshots",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RatedTier",
                table: "RankSnapshots",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RatedTierAfter",
                table: "MatchRanks",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RatedTierBefore",
                table: "MatchRanks",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Game",
                table: "Matches",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "lol");

            migrationBuilder.AddColumn<string>(
                name: "TftSetCoreName",
                table: "Matches",
                type: "nvarchar(32)",
                maxLength: 32,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "TftSetNumber",
                table: "Matches",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "RatedRating",
                table: "LeagueEntries",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "RatedTier",
                table: "LeagueEntries",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddPrimaryKey(
                name: "PK_SyncStates",
                table: "SyncStates",
                columns: new[] { "RiotAccountId", "Game" });

            migrationBuilder.CreateTable(
                name: "ScopedPuuids",
                columns: table => new
                {
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Scope = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    Puuid = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: false),
                    ResolvedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ScopedPuuids", x => new { x.RiotAccountId, x.Scope });
                    table.ForeignKey(
                        name: "FK_ScopedPuuids_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TftParticipants",
                columns: table => new
                {
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Puuid = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: false),
                    GameName = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    TagLine = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    Placement = table.Column<int>(type: "int", nullable: false),
                    TeamPlacement = table.Column<int>(type: "int", nullable: true),
                    PartnerGroupId = table.Column<int>(type: "int", nullable: true),
                    Level = table.Column<int>(type: "int", nullable: false),
                    LastRound = table.Column<int>(type: "int", nullable: false),
                    TimeEliminated = table.Column<double>(type: "float", nullable: false),
                    PlayersEliminated = table.Column<int>(type: "int", nullable: false),
                    TotalDamageToPlayers = table.Column<int>(type: "int", nullable: false),
                    GoldLeft = table.Column<int>(type: "int", nullable: false),
                    Win = table.Column<bool>(type: "bit", nullable: false),
                    TraitsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    UnitsJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    AugmentsJson = table.Column<string>(type: "nvarchar(1024)", maxLength: 1024, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TftParticipants", x => new { x.MatchId, x.Puuid });
                    table.ForeignKey(
                        name: "FK_TftParticipants_Matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "Matches",
                        principalColumn: "MatchId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_Game_StartsAt",
                table: "Seasons",
                columns: new[] { "Game", "StartsAt" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ScopedPuuids_Scope_Puuid",
                table: "ScopedPuuids",
                columns: new[] { "Scope", "Puuid" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TftParticipants_Puuid",
                table: "TftParticipants",
                column: "Puuid");

            // TFT's sets, each of which reset its ladders. Stored as UTC midnight
            // on launch day, for the reason League's season was: a migration
            // cannot know the host's timezone, and ranked is closed across a
            // changeover. Set 13 onwards because that is as far back as any
            // backfill reaches; an admin can add older ones, or correct these,
            // in the seasons editor.
            migrationBuilder.InsertData(
                table: "Seasons",
                columns: ["Label", "StartsAt", "IsPreseason", "ResetsRank", "Game"],
                values: new object[,]
                {
                    { "Set 13", 1732060800000L, false, true, "tft" },
                    { "Set 14", 1743552000000L, false, true, "tft" },
                    { "Set 15", 1753833600000L, false, true, "tft" },
                    { "Set 16", 1764720000000L, false, true, "tft" },
                    { "Set 17", 1776211200000L, false, true, "tft" },
                    { "Set 18", 1787702400000L, false, true, "tft" }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // TFT's rows go with the columns that say they are TFT's, or they
            // would come back as League's: seasons as League boundaries, and
            // TFT's ladders and retired TFT-key ids where the code before TFT
            // reads every queue and every retired puuid as League's. Readings
            // and LP rows first, before the matches some of them name.
            migrationBuilder.Sql(
                "DELETE FROM RankSnapshots WHERE QueueType IN ('RANKED_TFT', 'RANKED_TFT_DOUBLE_UP', 'RANKED_TFT_TURBO')");
            migrationBuilder.Sql(
                "DELETE FROM MatchRanks WHERE QueueType IN ('RANKED_TFT', 'RANKED_TFT_DOUBLE_UP', 'RANKED_TFT_TURBO')");
            migrationBuilder.Sql(
                "DELETE FROM LeagueEntries WHERE QueueType IN ('RANKED_TFT', 'RANKED_TFT_DOUBLE_UP', 'RANKED_TFT_TURBO')");
            migrationBuilder.Sql("DELETE FROM RetiredPuuids WHERE Scope <> 'main'");
            migrationBuilder.Sql("DELETE FROM Seasons WHERE Game <> 'lol'");
            migrationBuilder.Sql("DELETE FROM SyncStates WHERE Game <> 'lol'");
            migrationBuilder.Sql("DELETE FROM Matches WHERE Game <> 'lol'");

            migrationBuilder.DropTable(
                name: "ScopedPuuids");

            migrationBuilder.DropTable(
                name: "TftParticipants");

            migrationBuilder.DropPrimaryKey(
                name: "PK_SyncStates",
                table: "SyncStates");

            migrationBuilder.DropIndex(
                name: "IX_Seasons_Game_StartsAt",
                table: "Seasons");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "SyncStates");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "Seasons");

            migrationBuilder.DropColumn(
                name: "Scope",
                table: "RetiredPuuids");

            migrationBuilder.DropColumn(
                name: "RatedRating",
                table: "RankSnapshots");

            migrationBuilder.DropColumn(
                name: "RatedTier",
                table: "RankSnapshots");

            migrationBuilder.DropColumn(
                name: "RatedTierAfter",
                table: "MatchRanks");

            migrationBuilder.DropColumn(
                name: "RatedTierBefore",
                table: "MatchRanks");

            migrationBuilder.DropColumn(
                name: "Game",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "TftSetCoreName",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "TftSetNumber",
                table: "Matches");

            migrationBuilder.DropColumn(
                name: "RatedRating",
                table: "LeagueEntries");

            migrationBuilder.DropColumn(
                name: "RatedTier",
                table: "LeagueEntries");

            migrationBuilder.AddPrimaryKey(
                name: "PK_SyncStates",
                table: "SyncStates",
                column: "RiotAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_StartsAt",
                table: "Seasons",
                column: "StartsAt",
                unique: true);
        }
    }
}
