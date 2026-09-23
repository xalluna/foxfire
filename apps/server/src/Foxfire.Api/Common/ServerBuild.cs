using System.Reflection;

namespace Foxfire.Api.Common;

/// <summary>The build running here.</summary>
public static class ServerBuild
{
    /// <summary>
    /// The server's version, from <c>VersionPrefix</c> in Directory.Build.props.
    ///
    /// Without the commit hash the SDK appends after a '+': /version reports it to
    /// clients, and every log line carries it, and in both places the version is
    /// what anybody reading it is looking for.
    /// </summary>
    public static readonly string Version =
        typeof(ServerBuild).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion.Split('+')[0]
        ?? "0.0.0";
}
