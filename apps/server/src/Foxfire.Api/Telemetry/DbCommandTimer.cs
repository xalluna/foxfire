using System.Data.Common;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace Foxfire.Api.Telemetry;

/// <summary>
/// Times every command EF sends to SQL Server.
///
/// EF already knows how long each took — it hands the duration to every
/// interceptor — so this only passes it on. A slow page is usually a slow query,
/// and this is what tells a host whether the database is where the time goes.
/// Kept to the kind of command: its text would carry values, and the page wants
/// the shape of the load rather than a query log.
/// </summary>
public sealed class DbCommandTimer(ServerMetrics metrics) : DbCommandInterceptor
{
    public override DbDataReader ReaderExecuted(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result)
    {
        Record("reader", eventData);
        return base.ReaderExecuted(command, eventData, result);
    }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        DbDataReader result,
        CancellationToken cancellationToken = default)
    {
        Record("reader", eventData);
        return base.ReaderExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    {
        Record("nonquery", eventData);
        return base.NonQueryExecuted(command, eventData, result);
    }

    public override ValueTask<int> NonQueryExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        int result,
        CancellationToken cancellationToken = default)
    {
        Record("nonquery", eventData);
        return base.NonQueryExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    {
        Record("scalar", eventData);
        return base.ScalarExecuted(command, eventData, result);
    }

    public override ValueTask<object?> ScalarExecutedAsync(
        DbCommand command,
        CommandExecutedEventData eventData,
        object? result,
        CancellationToken cancellationToken = default)
    {
        Record("scalar", eventData);
        return base.ScalarExecutedAsync(command, eventData, result, cancellationToken);
    }

    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData)
    {
        ArgumentNullException.ThrowIfNull(eventData);
        metrics.DbCommand("failed", eventData.Duration);
        base.CommandFailed(command, eventData);
    }

    public override Task CommandFailedAsync(
        DbCommand command,
        CommandErrorEventData eventData,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(eventData);
        metrics.DbCommand("failed", eventData.Duration);
        return base.CommandFailedAsync(command, eventData, cancellationToken);
    }

    private void Record(string kind, CommandExecutedEventData eventData)
    {
        ArgumentNullException.ThrowIfNull(eventData);
        metrics.DbCommand(kind, eventData.Duration);
    }
}
