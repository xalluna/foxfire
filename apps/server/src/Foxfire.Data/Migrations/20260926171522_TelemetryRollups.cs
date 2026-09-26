using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class TelemetryRollups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TelemetryRollups",
                columns: table => new
                {
                    Id = table.Column<long>(type: "bigint", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    Resolution = table.Column<byte>(type: "tinyint", nullable: false),
                    BucketStart = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    Metric = table.Column<string>(type: "varchar(64)", unicode: false, maxLength: 64, nullable: false),
                    Dimensions = table.Column<string>(type: "nvarchar(256)", maxLength: 256, nullable: false),
                    Instance = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Count = table.Column<long>(type: "bigint", nullable: false),
                    Sum = table.Column<double>(type: "float", nullable: false),
                    Min = table.Column<double>(type: "float", nullable: false),
                    Max = table.Column<double>(type: "float", nullable: false),
                    Buckets = table.Column<string>(type: "varchar(512)", unicode: false, maxLength: 512, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TelemetryRollups", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryRollups_Hour",
                table: "TelemetryRollups",
                columns: new[] { "Resolution", "BucketStart", "Metric", "Dimensions" },
                unique: true,
                filter: "[Resolution] = 2");

            migrationBuilder.CreateIndex(
                name: "IX_TelemetryRollups_Resolution_Metric_BucketStart",
                table: "TelemetryRollups",
                columns: new[] { "Resolution", "Metric", "BucketStart" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TelemetryRollups");
        }
    }
}
