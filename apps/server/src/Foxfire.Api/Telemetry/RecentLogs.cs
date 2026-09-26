using System.Globalization;
using Foxfire.Api.Common;
using Serilog.Core;
using Serilog.Events;

namespace Foxfire.Api.Telemetry;

/// <summary>One log line, as the insights page lists it.</summary>
/// <param name="Seq">
/// Counts up from the first line this process wrote. A "Show more" asks for
/// lines before the newest it was first shown, so lines written since do not
/// shift the pages under it.
/// </param>
/// <param name="Level">information, warning, error or fatal.</param>
/// <param name="Message">Rendered, as it would read in the console.</param>
/// <param name="Source">The class that wrote it, without its namespace.</param>
/// <param name="TraceId">The request it was written during, as <c>X-Trace-Id</c> names it.</param>
public sealed record ServerLogEntry(
    long Seq,
    DateTimeOffset At,
    string Level,
    string Message,
    string? Source,
    string? TraceId,
    string? Exception);

/// <summary>
/// The most recent log lines, held in memory for the insights page.
///
/// Two rings rather than one, because every request writes a line at
/// Information: a single ring of two thousand would lose this morning's error
/// to this afternoon's page views. The warnings and errors are kept apart, and
/// last much longer. Rendered once, as they arrive — no event object is kept —
/// and never more than the lines themselves: the rules for what a log line may
/// carry (see CLAUDE.md, "Server logging") are what make them fit to show an
/// admin, and this adds nothing to them.
///
/// Also counts every line by level, which the collector turns into the
/// warnings-and-errors chart. The blob store keeps the logs for good; this is
/// the part worth a glance.
/// </summary>
public sealed class RecentLogs : ILogEventSink
{
    /// <summary>Lines of any level kept.</summary>
    public const int AllCapacity = 2_000;

    /// <summary>Warnings and worse kept, apart from the rest.</summary>
    public const int ProblemCapacity = 500;

    private const int MessageLength = 2_000;
    private const int ExceptionLength = 8_000;

    private readonly Lock _gate = new();
    private readonly LinkedList<ServerLogEntry> _all = new();
    private readonly LinkedList<ServerLogEntry> _problems = new();
    private readonly long[] _counts = new long[(int)LogEventLevel.Fatal + 1];
    private long _seq;

    public void Emit(LogEvent logEvent)
    {
        ArgumentNullException.ThrowIfNull(logEvent);
        if (logEvent.Level < LogEventLevel.Information) return;

        var entry = new ServerLogEntry(
            Interlocked.Increment(ref _seq),
            logEvent.Timestamp,
            LevelName(logEvent.Level),
            Trim(logEvent.RenderMessage(CultureInfo.InvariantCulture), MessageLength),
            SourceOf(logEvent),
            logEvent.TraceId?.ToHexString(),
            logEvent.Exception is { } ex ? Trim(ex.ToString(), ExceptionLength) : null);

        lock (_gate)
        {
            _counts[(int)logEvent.Level]++;

            Push(_all, entry, AllCapacity);
            if (logEvent.Level >= LogEventLevel.Warning) Push(_problems, entry, ProblemCapacity);
        }
    }

    /// <summary>Lines written at each level since the process started, for Information and up.</summary>
    public IReadOnlyDictionary<string, long> Counts()
    {
        lock (_gate)
        {
            return new Dictionary<string, long>
            {
                ["information"] = _counts[(int)LogEventLevel.Information],
                ["warning"] = _counts[(int)LogEventLevel.Warning],
                ["error"] = _counts[(int)LogEventLevel.Error],
                ["fatal"] = _counts[(int)LogEventLevel.Fatal]
            };
        }
    }

    /// <summary>
    /// A page of the lines at or above <paramref name="minimum"/>, newest first.
    /// </summary>
    /// <param name="minimum">information, warning or error; anything else is information.</param>
    /// <param name="before">Only lines older than this sequence number, when given.</param>
    public Page<ServerLogEntry> Read(string? minimum, PageRequest page, long? before)
    {
        var level = minimum switch
        {
            "error" => LogEventLevel.Error,
            "warning" => LogEventLevel.Warning,
            _ => LogEventLevel.Information
        };

        List<ServerLogEntry> matching;
        lock (_gate)
        {
            var ring = level >= LogEventLevel.Warning ? _problems : _all;
            matching = [.. ring.Where(e => Rank(e.Level) >= level && (before is not { } b || e.Seq < b))];
        }

        // The rings are oldest first; the page is newest first.
        matching.Reverse();
        return new Page<ServerLogEntry>([.. matching.Skip(page.Offset).Take(page.Limit)], matching.Count);
    }

    private static void Push(LinkedList<ServerLogEntry> ring, ServerLogEntry entry, int capacity)
    {
        ring.AddLast(entry);
        while (ring.Count > capacity) ring.RemoveFirst();
    }

    private static string LevelName(LogEventLevel level) => level switch
    {
        LogEventLevel.Fatal => "fatal",
        LogEventLevel.Error => "error",
        LogEventLevel.Warning => "warning",
        _ => "information"
    };

    private static LogEventLevel Rank(string level) => level switch
    {
        "fatal" => LogEventLevel.Fatal,
        "error" => LogEventLevel.Error,
        "warning" => LogEventLevel.Warning,
        _ => LogEventLevel.Information
    };

    private static string? SourceOf(LogEvent logEvent)
    {
        if (!logEvent.Properties.TryGetValue("SourceContext", out var value)) return null;
        if (value is not ScalarValue { Value: string source }) return null;

        var dot = source.LastIndexOf('.');
        return dot >= 0 ? source[(dot + 1)..] : source;
    }

    private static string Trim(string text, int length) =>
        text.Length <= length ? text : string.Concat(text.AsSpan(0, length), "…");
}
