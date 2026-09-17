using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class GameData : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ChampionMasteries",
                columns: table => new
                {
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    ChampionId = table.Column<int>(type: "int", nullable: false),
                    ChampionPoints = table.Column<int>(type: "int", nullable: true),
                    ChampionLevel = table.Column<int>(type: "int", nullable: true),
                    LastPlayTime = table.Column<long>(type: "bigint", nullable: true),
                    FetchedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ChampionMasteries", x => new { x.RiotAccountId, x.ChampionId });
                    table.ForeignKey(
                        name: "FK_ChampionMasteries_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LeagueEntries",
                columns: table => new
                {
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    QueueType = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Tier = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    Division = table.Column<string>(type: "nvarchar(4)", maxLength: 4, nullable: true),
                    LeaguePoints = table.Column<int>(type: "int", nullable: true),
                    Wins = table.Column<int>(type: "int", nullable: true),
                    Losses = table.Column<int>(type: "int", nullable: true),
                    FetchedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeagueEntries", x => new { x.RiotAccountId, x.QueueType });
                    table.ForeignKey(
                        name: "FK_LeagueEntries_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Matches",
                columns: table => new
                {
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    GameCreation = table.Column<long>(type: "bigint", nullable: false),
                    GameDuration = table.Column<int>(type: "int", nullable: false),
                    GameMode = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    GameType = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    QueueId = table.Column<int>(type: "int", nullable: true),
                    PlatformId = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: true),
                    RawJson = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    FetchedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Matches", x => x.MatchId);
                });

            migrationBuilder.CreateTable(
                name: "RetiredPuuids",
                columns: table => new
                {
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Puuid = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: false),
                    RetiredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RetiredPuuids", x => new { x.RiotAccountId, x.Puuid });
                    table.ForeignKey(
                        name: "FK_RetiredPuuids_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Seasons",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Label = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: false),
                    StartsAt = table.Column<long>(type: "bigint", nullable: false),
                    IsPreseason = table.Column<bool>(type: "bit", nullable: false),
                    ResetsRank = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Seasons", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SyncStates",
                columns: table => new
                {
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    MostRecentMatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    BackfillComplete = table.Column<bool>(type: "bit", nullable: false),
                    BackfillTarget = table.Column<int>(type: "int", nullable: false),
                    LastFullSyncAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LastDeltaSyncAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SyncStates", x => x.RiotAccountId);
                    table.ForeignKey(
                        name: "FK_SyncStates_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MatchParticipants",
                columns: table => new
                {
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Puuid = table.Column<string>(type: "nvarchar(78)", maxLength: 78, nullable: false),
                    GameName = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    TagLine = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    TeamId = table.Column<int>(type: "int", nullable: false),
                    Win = table.Column<bool>(type: "bit", nullable: false),
                    ChampionId = table.Column<int>(type: "int", nullable: false),
                    ChampionName = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    ChampLevel = table.Column<int>(type: "int", nullable: true),
                    Kills = table.Column<int>(type: "int", nullable: true),
                    Deaths = table.Column<int>(type: "int", nullable: true),
                    Assists = table.Column<int>(type: "int", nullable: true),
                    GoldEarned = table.Column<int>(type: "int", nullable: true),
                    Cs = table.Column<int>(type: "int", nullable: true),
                    DamageDealtToChampions = table.Column<int>(type: "int", nullable: true),
                    DamageTaken = table.Column<int>(type: "int", nullable: true),
                    ItemsJson = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: true),
                    RoleBoundItem = table.Column<int>(type: "int", nullable: false),
                    Summoner1Id = table.Column<int>(type: "int", nullable: true),
                    Summoner2Id = table.Column<int>(type: "int", nullable: true),
                    PerksJson = table.Column<string>(type: "nvarchar(2048)", maxLength: 2048, nullable: true),
                    TeamPosition = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    LargestMultiKill = table.Column<int>(type: "int", nullable: true),
                    GameEndedInEarlySurrender = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MatchParticipants", x => new { x.MatchId, x.Puuid });
                    table.ForeignKey(
                        name: "FK_MatchParticipants_Matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "Matches",
                        principalColumn: "MatchId",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "MatchRanks",
                columns: table => new
                {
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    QueueType = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    TierBefore = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    DivisionBefore = table.Column<string>(type: "nvarchar(4)", maxLength: 4, nullable: true),
                    LpBefore = table.Column<int>(type: "int", nullable: true),
                    TierAfter = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    DivisionAfter = table.Column<string>(type: "nvarchar(4)", maxLength: 4, nullable: true),
                    LpAfter = table.Column<int>(type: "int", nullable: true),
                    LpDelta = table.Column<int>(type: "int", nullable: false),
                    IsPromotion = table.Column<bool>(type: "bit", nullable: false),
                    IsDemotion = table.Column<bool>(type: "bit", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MatchRanks", x => new { x.MatchId, x.RiotAccountId });
                    table.ForeignKey(
                        name: "FK_MatchRanks_Matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "Matches",
                        principalColumn: "MatchId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MatchRanks_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id");
                });

            migrationBuilder.CreateTable(
                name: "RankSnapshots",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    QueueType = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Tier = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    Division = table.Column<string>(type: "nvarchar(4)", maxLength: 4, nullable: true),
                    LeaguePoints = table.Column<int>(type: "int", nullable: true),
                    Wins = table.Column<int>(type: "int", nullable: true),
                    Losses = table.Column<int>(type: "int", nullable: true),
                    LadderPosition = table.Column<int>(type: "int", nullable: true),
                    Source = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    CapturedAt = table.Column<long>(type: "bigint", nullable: false),
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RankSnapshots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RankSnapshots_Matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "Matches",
                        principalColumn: "MatchId");
                    table.ForeignKey(
                        name: "FK_RankSnapshots_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Matches_GameCreation",
                table: "Matches",
                column: "GameCreation");

            migrationBuilder.CreateIndex(
                name: "IX_Matches_QueueId",
                table: "Matches",
                column: "QueueId");

            migrationBuilder.CreateIndex(
                name: "IX_MatchParticipants_MatchId_TeamId",
                table: "MatchParticipants",
                columns: new[] { "MatchId", "TeamId" });

            migrationBuilder.CreateIndex(
                name: "IX_MatchParticipants_Puuid",
                table: "MatchParticipants",
                column: "Puuid");

            migrationBuilder.CreateIndex(
                name: "IX_MatchParticipants_Puuid_GameEndedInEarlySurrender",
                table: "MatchParticipants",
                columns: new[] { "Puuid", "GameEndedInEarlySurrender" });

            migrationBuilder.CreateIndex(
                name: "IX_MatchRanks_RiotAccountId",
                table: "MatchRanks",
                column: "RiotAccountId");

            migrationBuilder.CreateIndex(
                name: "IX_RankSnapshots_MatchId",
                table: "RankSnapshots",
                column: "MatchId");

            migrationBuilder.CreateIndex(
                name: "IX_RankSnapshots_RiotAccountId_QueueType_CapturedAt",
                table: "RankSnapshots",
                columns: new[] { "RiotAccountId", "QueueType", "CapturedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_StartsAt",
                table: "Seasons",
                column: "StartsAt",
                unique: true);

            // The one ranked boundary that could actually be verified: Riot
            // opened the 2026 ranked year on 8 January 2026.
            //
            // Seeded because with no seasons recorded at all the reset guard
            // cannot fire, and the first January after a server is stood up is
            // exactly when it matters — an unseeded server would hand the annual
            // reset to whichever game sat beside it as a two-thousand point loss.
            //
            // Stored as UTC midnight, because a migration cannot know the host's
            // timezone. That is a few hours either side of local midnight, and
            // ranked queues are closed across a changeover, so nothing can be
            // misfiled by it. An admin can correct it, and nothing older is
            // seeded: no other date could be confirmed, and the oldest season
            // reaching backwards forever means earlier history still has
            // somewhere to live.
            migrationBuilder.InsertData(
                table: "Seasons",
                columns: ["Label", "StartsAt", "IsPreseason", "ResetsRank"],
                values: ["Season 2026", 1767830400000L, false, true]);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ChampionMasteries");

            migrationBuilder.DropTable(
                name: "LeagueEntries");

            migrationBuilder.DropTable(
                name: "MatchParticipants");

            migrationBuilder.DropTable(
                name: "MatchRanks");

            migrationBuilder.DropTable(
                name: "RankSnapshots");

            migrationBuilder.DropTable(
                name: "RetiredPuuids");

            migrationBuilder.DropTable(
                name: "Seasons");

            migrationBuilder.DropTable(
                name: "SyncStates");

            migrationBuilder.DropTable(
                name: "Matches");
        }
    }
}
