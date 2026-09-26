using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class Email : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EmailMessages",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Kind = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Priority = table.Column<byte>(type: "tinyint", nullable: false),
                    Provider = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Recipient = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Subject = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Status = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(64)", maxLength: 64, nullable: true),
                    Detail = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    ProviderMessageId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: true),
                    TriggeredByUserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    RelatedId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    NotBefore = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    WorthlessAfter = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    LeaseUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Attempts = table.Column<int>(type: "int", nullable: false),
                    SentAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    DeliveredAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    LastEventAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailMessages", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EmailQuotaObservations",
                columns: table => new
                {
                    Provider = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Window = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    Used = table.Column<int>(type: "int", nullable: false),
                    ObservedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExhaustedUntil = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailQuotaObservations", x => new { x.Provider, x.Window });
                });

            migrationBuilder.CreateTable(
                name: "EmailSuppressions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Address = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Reason = table.Column<string>(type: "nvarchar(32)", maxLength: 32, nullable: false),
                    Detail = table.Column<string>(type: "nvarchar(500)", maxLength: 500, nullable: true),
                    MessageId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailSuppressions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EmailVerifications",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Email = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Purpose = table.Column<string>(type: "nvarchar(16)", maxLength: 16, nullable: false),
                    SecurityStamp = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    ExpiresAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    RedeemedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    RevokedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmailVerifications", x => x.Id);
                    table.ForeignKey(
                        name: "FK_EmailVerifications_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_CreatedAt_Id",
                table: "EmailMessages",
                columns: new[] { "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_Kind_RelatedId_CreatedAt",
                table: "EmailMessages",
                columns: new[] { "Kind", "RelatedId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_Pending",
                table: "EmailMessages",
                columns: new[] { "Priority", "NotBefore", "CreatedAt" },
                filter: "[Status] IN ('queued', 'sending', 'held')");

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_ProviderMessageId",
                table: "EmailMessages",
                column: "ProviderMessageId",
                filter: "[ProviderMessageId] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_Recipient",
                table: "EmailMessages",
                column: "Recipient");

            migrationBuilder.CreateIndex(
                name: "IX_EmailMessages_SentAt",
                table: "EmailMessages",
                column: "SentAt",
                filter: "[SentAt] IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_EmailSuppressions_Address",
                table: "EmailSuppressions",
                column: "Address",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EmailSuppressions_CreatedAt_Id",
                table: "EmailSuppressions",
                columns: new[] { "CreatedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_EmailVerifications_UserId_Purpose_CreatedAt",
                table: "EmailVerifications",
                columns: new[] { "UserId", "Purpose", "CreatedAt" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmailMessages");

            migrationBuilder.DropTable(
                name: "EmailQuotaObservations");

            migrationBuilder.DropTable(
                name: "EmailSuppressions");

            migrationBuilder.DropTable(
                name: "EmailVerifications");
        }
    }
}
