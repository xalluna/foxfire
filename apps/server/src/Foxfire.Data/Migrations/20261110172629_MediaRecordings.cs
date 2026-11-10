using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class MediaRecordings : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // A row from before was a YouTube video, which is not a Foxfire Media one
            // and has nothing a player could open now. The feature never shipped
            // in a release build, so these are a developer's test rows at most.
            migrationBuilder.Sql("DELETE FROM MatchRecordings");

            migrationBuilder.DropColumn(
                name: "Privacy",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "MatchRecordings");

            migrationBuilder.RenameColumn(
                name: "YouTubeVideoId",
                table: "MatchRecordings",
                newName: "VideoId");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "MatchRecordings",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100,
                oldNullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CheckedAt",
                table: "MatchRecordings",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Error",
                table: "MatchRecordings",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "MatchRecordings",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ReadyAt",
                table: "MatchRecordings",
                type: "datetimeoffset",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "SizeBytes",
                table: "MatchRecordings",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "MatchRecordings",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_MatchRecordings_VideoId",
                table: "MatchRecordings",
                column: "VideoId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_MatchRecordings_VideoId",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "CheckedAt",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "Error",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "ReadyAt",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "SizeBytes",
                table: "MatchRecordings");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "MatchRecordings");

            migrationBuilder.RenameColumn(
                name: "VideoId",
                table: "MatchRecordings",
                newName: "YouTubeVideoId");

            migrationBuilder.AlterColumn<string>(
                name: "Title",
                table: "MatchRecordings",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(200)",
                oldMaxLength: 200,
                oldNullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Privacy",
                table: "MatchRecordings",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "MatchRecordings",
                type: "nvarchar(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "");
        }
    }
}
