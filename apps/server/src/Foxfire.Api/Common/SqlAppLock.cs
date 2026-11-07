using System.Data;
using System.Data.Common;

namespace Foxfire.Api.Common;

/// <summary>
/// One process at a time, for work two processes must not both do.
///
/// The old and new processes of a deploy overlap for a moment, and some
/// background work is only right done once: two email dispatchers counting the
/// same day separately would each think there was room for the last message,
/// and two background sweeps would sync every account twice. So that work takes
/// an application lock in SQL Server first, and a process that cannot have it
/// sits the round out.
///
/// The lock is held by the session, and the session is the connection it was
/// taken on — so the caller keeps that connection open for as long as the work
/// runs, and a process that dies lets go of it with the connection.
/// </summary>
public static class SqlAppLock
{
    /// <summary>Takes the lock without waiting. False when another session holds it.</summary>
    public static async Task<bool> TryTakeAsync(
        DbConnection connection,
        string resource,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(connection);

        await using var command = connection.CreateCommand();
        command.CommandText =
            "DECLARE @result int; "
            + "EXEC @result = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', "
            + "@LockOwner = 'Session', @LockTimeout = 0; "
            + "SELECT @result;";

        var parameter = command.CreateParameter();
        parameter.ParameterName = "@resource";
        parameter.DbType = DbType.String;
        parameter.Value = resource;
        command.Parameters.Add(parameter);

        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is int granted && granted >= 0;
    }

    /// <summary>Lets go of it. A failure is only logged: closing the connection lets go anyway.</summary>
    public static async Task ReleaseAsync(DbConnection connection, string resource, ILogger log)
    {
        ArgumentNullException.ThrowIfNull(connection);

        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = "EXEC sp_releaseapplock @Resource = @resource, @LockOwner = 'Session';";

            var parameter = command.CreateParameter();
            parameter.ParameterName = "@resource";
            parameter.DbType = DbType.String;
            parameter.Value = resource;
            command.Parameters.Add(parameter);

            await command.ExecuteNonQueryAsync();
        }
        catch (DbException ex)
        {
            log.LogDebug(ex, "Could not release the {Resource} lock explicitly", resource);
        }
    }
}
