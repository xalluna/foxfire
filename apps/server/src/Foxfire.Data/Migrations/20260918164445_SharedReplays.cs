using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class SharedReplays : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SharedReplays",
                columns: table => new
                {
                    MatchId = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    BlobKey = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    FileBytes = table.Column<long>(type: "bigint", nullable: true),
                    GameVersion = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: true),
                    Patch = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: true),
                    DurationSeconds = table.Column<int>(type: "int", nullable: true),
                    UploadedByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    ClaimedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UploadedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SharedReplays", x => x.MatchId);
                    table.ForeignKey(
                        name: "FK_SharedReplays_Users_UploadedByUserId",
                        column: x => x.UploadedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SharedReplays_UploadedAt",
                table: "SharedReplays",
                column: "UploadedAt");

            migrationBuilder.CreateIndex(
                name: "IX_SharedReplays_UploadedByUserId",
                table: "SharedReplays",
                column: "UploadedByUserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SharedReplays");
        }
    }
}
