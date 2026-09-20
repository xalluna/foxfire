using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Foxfire.Data.Migrations
{
    /// <inheritdoc />
    public partial class ItemsAsCollection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Before the column can refuse nulls, it has to not hold any.
            //
            // defaultValue below does not do this: it creates a DEFAULT
            // constraint for rows written afterwards, and SQL Server rejects
            // the ALTER outright if any existing row is null. Nothing has ever
            // written one — ingestion always serialised the seven slots, and
            // the import goes through the same writer — so this should touch
            // no rows. It is here because "should" is doing the work in that
            // sentence, and the alternative is a migration that fails on
            // somebody's database and not on ours.
            migrationBuilder.Sql(
                "UPDATE MatchParticipants SET ItemsJson = '[]' WHERE ItemsJson IS NULL");

            migrationBuilder.AlterColumn<string>(
                name: "ItemsJson",
                table: "MatchParticipants",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: false,
                defaultValue: "[]",
                oldClrType: typeof(string),
                oldType: "nvarchar(256)",
                oldMaxLength: 256,
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "ItemsJson",
                table: "MatchParticipants",
                type: "nvarchar(256)",
                maxLength: 256,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "nvarchar(256)",
                oldMaxLength: 256);
        }
    }
}
