using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class MatchRecordings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "MatchRecordings",
                columns: table => new
                {
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    RiotAccountId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    YouTubeVideoId = table.Column<string>(type: "nvarchar(11)", maxLength: 11, nullable: false),
                    Privacy = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    Title = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: true),
                    DurationSeconds = table.Column<int>(type: "int", nullable: true),
                    EventsJson = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Source = table.Column<string>(type: "nvarchar(8)", maxLength: 8, nullable: false),
                    AttachedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    AttachedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MatchRecordings", x => new { x.MatchId, x.RiotAccountId });
                    table.ForeignKey(
                        name: "FK_MatchRecordings_Matches_MatchId",
                        column: x => x.MatchId,
                        principalTable: "Matches",
                        principalColumn: "MatchId",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_MatchRecordings_RiotAccounts_RiotAccountId",
                        column: x => x.RiotAccountId,
                        principalTable: "RiotAccounts",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_MatchRecordings_Users_AttachedByUserId",
                        column: x => x.AttachedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_MatchRecordings_AttachedByUserId",
                table: "MatchRecordings",
                column: "AttachedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_MatchRecordings_RiotAccountId",
                table: "MatchRecordings",
                column: "RiotAccountId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "MatchRecordings");
        }
    }
}
