using System.Data;
using System.Data.Common;
using Foxfire.Api.Configuration;
using Foxfire.Api.Telemetry;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Email;

/// <summary>
/// Sends what the outbox holds, within the limits, and writes down how it went.
///
/// It wakes when something is queued, and every fifteen seconds regardless, and
/// works through whatever is due in order: account security first, then the
/// rest, oldest first within each. For each message it asks the budget whether
/// there is room, claims the row, builds the message from what it is about, and
/// hands it to the provider — then records what the provider said, about the
/// message and about the quota.
///
/// One process sends at a time. The old and new processes of a deploy overlap
/// for a moment, and two dispatchers counting the same day separately would
/// each think there was room for the last message. So a round starts by taking
/// an application lock in SQL Server; a process that cannot have it sits the
/// round out. The lock is on the session, and the session is this round's
/// connection, so a process that dies lets go of it with the connection.
///
/// A message is claimed before it is sent — status sending, with a lease — so
/// that a process that dies mid-send leaves something the next round can see.
/// When the lease lapses it is sent again, under the same idempotency key, which
/// the provider recognises if the first attempt did get through.
/// </summary>
public sealed class EmailDispatcher : BackgroundService
{
    /// <summary>How often it looks when nothing has told it to.</summary>
    public static readonly TimeSpan Tick = TimeSpan.FromSeconds(15);

    /// <summary>How long a claimed message is given — well past the client's fifteen-second timeout.</summary>
    public static readonly TimeSpan Lease = TimeSpan.FromMinutes(2);

    /// <summary>Between two sends, to stay under Resend's ten requests a second with room to spare.</summary>
    public static readonly TimeSpan Pace = TimeSpan.FromMilliseconds(110);

    /// <summary>How long to wait after the provider refuses the key or the domain before asking again.</summary>
    public static readonly TimeSpan RefusedWait = TimeSpan.FromHours(1);

    /// <summary>Attempts before a message that keeps failing transiently is given up on.</summary>
    public const int MaxAttempts = 8;

    /// <summary>Messages a round sends before it lets the loop breathe.</summary>
    public const int MaxPerRound = 50;

    private const string LockResource = "foxfire.email.dispatch";

    private static readonly TimeSpan[] Backoff =
    [
        TimeSpan.FromSeconds(30),
        TimeSpan.FromMinutes(1),
        TimeSpan.FromMinutes(2),
        TimeSpan.FromMinutes(5),
        TimeSpan.FromMinutes(10),
        TimeSpan.FromMinutes(30),
        TimeSpan.FromHours(1),
        TimeSpan.FromHours(2)
    ];

    private readonly IServiceScopeFactory _scopes;
    private readonly ActiveEmailProvider _active;
    private readonly EmailSignal _signal;
    private readonly EmailState _state;
    private readonly ServerMetrics _metrics;
    private readonly TimeProvider _time;
    private readonly IOptions<EmailOptions> _options;
    private readonly ILogger<EmailDispatcher> _log;
    private readonly HashSet<string> _warned = [];

    private DateTimeOffset? _refusedUntil;
    private DateTimeOffset? _lastSweep;

    public EmailDispatcher(
        IServiceScopeFactory scopes,
        ActiveEmailProvider active,
        EmailSignal signal,
        EmailState state,
        ServerMetrics metrics,
        TimeProvider time,
        IOptions<EmailOptions> options,
        ILogger<EmailDispatcher> log)
    {
        _scopes = scopes;
        _active = active;
        _signal = signal;
        _state = state;
        _metrics = metrics;
        _time = time;
        _options = options;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // A server that sends no mail never touches the outbox. That matters
        // beyond tidiness: the test suite runs dozens of hosts on one database,
        // and only the ones that turned mail on should be sending any of it.
        if (!_active.IsEnabled) return;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                var more = false;

                try
                {
                    more = await RunOnceAsync(stoppingToken);
                    await SweepIfDueAsync(stoppingToken);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // A background service that throws takes the host with it,
                    // and mail is not worth the server. The next round tries again.
                    _log.LogWarning(ex, "Could not send email this round; trying again shortly");
                }

                if (!more) await _signal.WaitAsync(Tick, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Shutting down. Anything claimed and not finished is picked up by
            // the next process once its lease lapses.
        }
    }

    /// <summary>
    /// One round: take the lock, send what is due and fits, let go.
    /// True when the round stopped with work still due, so the caller should go
    /// again at once rather than wait for the tick.
    /// </summary>
    public async Task<bool> RunOnceAsync(CancellationToken cancellationToken)
    {
        if (_active.Provider is not { } provider) return false;

        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();
        var renderer = scope.ServiceProvider.GetRequiredService<EmailRenderer>();

        await db.Database.OpenConnectionAsync(cancellationToken);

        try
        {
            var connection = db.Database.GetDbConnection();
            if (!await TryLockAsync(connection, cancellationToken)) return false;

            try
            {
                return await DispatchAsync(db, renderer, provider, cancellationToken);
            }
            finally
            {
                await ReleaseAsync(connection);
            }
        }
        finally
        {
            await db.Database.CloseConnectionAsync();
        }
    }

    /// <summary>Drops finished mail, and spent confirmation links, older than the retention period.</summary>
    public async Task<int> SweepAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var days = _options.Value.RetentionDays;
        if (days <= 0) return 0;

        var cutoff = now - TimeSpan.FromDays(days);

        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FoxfireDbContext>();

        var messages = await db.EmailMessages
            .Where(m => m.CreatedAt < cutoff)
            .Where(m => m.Status != EmailStatuses.Queued && m.Status != EmailStatuses.Held && m.Status != EmailStatuses.Sending)
            .ExecuteDeleteAsync(cancellationToken);

        var links = await db.EmailVerifications
            .Where(v => v.CreatedAt < cutoff)
            .Where(v => v.RedeemedAt != null || v.RevokedAt != null || v.ExpiresAt < now)
            .ExecuteDeleteAsync(cancellationToken);

        if (messages + links > 0)
        {
            _log.LogDebug(
                "Cleared {Messages} emails and {Links} confirmation links older than {Days} days",
                messages, links, days);
        }

        return messages + links;
    }

    private async Task SweepIfDueAsync(CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();
        if (_lastSweep is { } last && now - last < TimeSpan.FromHours(1)) return;

        _lastSweep = now;
        await SweepAsync(now, cancellationToken);
    }

    private async Task<bool> DispatchAsync(
        FoxfireDbContext db,
        EmailRenderer renderer,
        IEmailProvider provider,
        CancellationToken cancellationToken)
    {
        var now = _time.GetUtcNow();

        // Whatever waited past the moment its link stopped working.
        var lapsed = await db.EmailMessages
            .Where(m => m.Provider == provider.Name)
            .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held)
            .Where(m => m.WorthlessAfter <= now)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.Status, EmailStatuses.Dropped)
                .SetProperty(m => m.Reason, "expired"), cancellationToken);

        if (lapsed > 0) _log.LogInformation("Dropped {Count} emails whose links expired before they could be sent", lapsed);

        // Whatever a process claimed and never finished — it died mid-send.
        await db.EmailMessages
            .Where(m => m.Provider == provider.Name && m.Status == EmailStatuses.Sending && m.LeaseUntil < now)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.Status, EmailStatuses.Queued)
                .SetProperty(m => m.LeaseUntil, (DateTimeOffset?)null), cancellationToken);

        var quota = await EmailQuota.ReadAsync(db, provider, now, cancellationToken);
        var counts = new Counts(quota);
        var sent = 0;

        for (var i = 0; i < MaxPerRound; i++)
        {
            now = _time.GetUtcNow();

            var next = await db.EmailMessages
                .AsNoTracking()
                .Where(m => m.Provider == provider.Name)
                .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held)
                .Where(m => m.NotBefore <= now)
                .OrderBy(m => m.Priority)
                .ThenBy(m => m.CreatedAt)
                .ThenBy(m => m.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (next is null)
            {
                await PublishAsync(db, provider, counts, cancellationToken);
                return false;
            }

            if (_refusedUntil is { } refusedUntil && refusedUntil > now)
            {
                await HoldDueAsync(db, provider, null, refusedUntil, "provider_refused", now, cancellationToken);
                continue;
            }

            var decision = EmailBudget.Decide(
                (EmailPriority)next.Priority,
                _options.Value.InviteShare,
                counts.Daily,
                counts.Monthly,
                now);

            if (decision is EmailBudgetDecision.Hold hold)
            {
                // A spent share holds the standard mail only; security mail is
                // sorted first, so none of it is left behind this one. A spent
                // limit holds everything.
                var only = hold.Reason == EmailBudget.StandardShare ? EmailPriority.Standard : (EmailPriority?)null;
                await HoldDueAsync(db, provider, only, hold.Until, hold.Reason, now, cancellationToken);
                continue;
            }

            var claimed = await db.EmailMessages
                .Where(m => m.Id == next.Id)
                .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held)
                .ExecuteUpdateAsync(s => s
                    .SetProperty(m => m.Status, EmailStatuses.Sending)
                    .SetProperty(m => m.LeaseUntil, now + Lease)
                    .SetProperty(m => m.Attempts, m => m.Attempts + 1), cancellationToken);

            if (claimed == 0) continue;

            var message = await db.EmailMessages.FirstAsync(m => m.Id == next.Id, cancellationToken);

            var render = await renderer.RenderAsync(message, cancellationToken);

            if (render is not EmailRender.Ready ready)
            {
                var reason = render is EmailRender.Drop drop ? drop.Reason : "gone";
                Finish(message, EmailStatuses.Dropped, reason);
                await db.SaveChangesAsync(cancellationToken);

                _metrics.EmailSent(message.Kind, "dropped");
                _log.LogInformation(
                    "Did not send {Kind} email {MessageId}: it is no longer worth sending ({Reason})",
                    message.Kind, message.Id, reason);
                continue;
            }

            if (sent++ > 0) await Task.Delay(Pace, _time, cancellationToken);

            var result = await provider.SendAsync(ready.Message, cancellationToken);
            now = _time.GetUtcNow();

            if (result.Usage is { } usage)
            {
                await EmailQuota.ObserveAsync(db, provider.Name, usage, cancellationToken);
                counts.Observe(usage);
            }

            // A pause the provider asked for — a rate limit, a refusal — is a
            // reason to wait for the next tick, not to go straight round again.
            var carryOn = await ApplyAsync(db, provider, message, result, counts, now, cancellationToken);
            if (!carryOn)
            {
                await PublishAsync(db, provider, counts, cancellationToken);
                return false;
            }
        }

        await PublishAsync(db, provider, counts, cancellationToken);
        return true;
    }

    /// <summary>
    /// Writes down what the provider said. False when the round should stop —
    /// the provider is refusing everything, or asking for a pause.
    /// </summary>
    private async Task<bool> ApplyAsync(
        FoxfireDbContext db,
        IEmailProvider provider,
        EmailMessage message,
        EmailSendResult result,
        Counts counts,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        switch (result)
        {
            case EmailSendResult.Accepted accepted:
                message.Status = EmailStatuses.Sent;
                message.SentAt = now;
                message.ProviderMessageId = accepted.ProviderMessageId;
                message.LeaseUntil = null;
                message.Reason = null;
                await db.SaveChangesAsync(cancellationToken);

                counts.Sent();
                _metrics.EmailSent(message.Kind, "sent");

                if (_refusedUntil is not null)
                {
                    _refusedUntil = null;
                    _log.LogInformation("{Provider} is accepting this server's email again", provider.Name);
                }

                _log.LogInformation(
                    "Emailed {Kind} {MessageId} to {Recipient} through {Provider} ({ProviderMessageId})",
                    message.Kind, message.Id, message.Recipient, provider.Name, accepted.ProviderMessageId);

                WarnIfNearLimits(counts);
                return true;

            case EmailSendResult.RateLimited limited:
                // Not the message's fault, so the attempt is not held against it.
                Requeue(message, now + limited.RetryAfter, "rate_limited", countAttempt: false);
                await db.SaveChangesAsync(cancellationToken);
                _metrics.EmailSent(message.Kind, "retry");
                return false;

            case EmailSendResult.QuotaExhausted exhausted:
                var window = EmailWindows.Of(exhausted.Window, now, provider.Limits.MonthlyResetDay);
                await EmailQuota.LatchAsync(db, provider.Name, exhausted.Window, window.End, cancellationToken);
                counts.Latch(exhausted.Window, window.End);

                message.Status = EmailStatuses.Held;
                message.NotBefore = window.End;
                message.Reason = EmailBudget.ProviderQuota;
                message.LeaseUntil = null;
                message.Attempts--;
                await db.SaveChangesAsync(cancellationToken);

                _metrics.EmailSent(message.Kind, "held");
                _log.LogWarning(
                    "{Provider} says this account's {Window} quota is spent, so email is held until {Until}",
                    provider.Name, exhausted.Window == QuotaWindow.Daily ? "daily" : "monthly", window.End);
                return true;

            case EmailSendResult.Transient transient when message.Attempts >= MaxAttempts:
                Finish(message, EmailStatuses.Failed, "gave_up");
                message.Detail = transient.Code;
                await db.SaveChangesAsync(cancellationToken);

                _metrics.EmailSent(message.Kind, "failed");
                _log.LogWarning(
                    "Gave up on {Kind} email {MessageId} to {Recipient} after {Attempts} attempts; the last said {Code}",
                    message.Kind, message.Id, message.Recipient, message.Attempts, transient.Code);
                return true;

            case EmailSendResult.Transient transient:
                var backoff = Backoff[Math.Clamp(message.Attempts - 1, 0, Backoff.Length - 1)];
                var wait = transient.RetryAfter is { } asked && asked > backoff ? asked : backoff;
                Requeue(message, now + wait, transient.Code, countAttempt: true);
                await db.SaveChangesAsync(cancellationToken);

                _metrics.EmailSent(message.Kind, "retry");
                _log.LogInformation(
                    "Will try {Kind} email {MessageId} again at {At}: {Provider} said {Code}",
                    message.Kind, message.Id, message.NotBefore, provider.Name, transient.Code);
                return true;

            case EmailSendResult.Permanent permanent:
                Finish(message, EmailStatuses.Failed, permanent.Code);
                await db.SaveChangesAsync(cancellationToken);

                _metrics.EmailSent(message.Kind, "failed");
                _log.LogWarning(
                    "{Provider} would not take {Kind} email {MessageId} to {Recipient}: {Code}",
                    provider.Name, message.Kind, message.Id, message.Recipient, permanent.Code);
                return true;

            case EmailSendResult.Refused refused:
                message.Status = EmailStatuses.Held;
                message.NotBefore = now + RefusedWait;
                message.Reason = "provider_refused";
                message.Detail = refused.Code;
                message.LeaseUntil = null;
                message.Attempts--;
                await db.SaveChangesAsync(cancellationToken);

                _metrics.EmailSent(message.Kind, "refused");

                if (_refusedUntil is null)
                {
                    _log.LogWarning(
                        "{Provider} refused this server's email ({Code}). Check Email__Resend__ApiKey and that the "
                        + "domain of Email__FromAddress is verified. Everything is held and will be tried again at {At}.",
                        provider.Name, refused.Code, now + RefusedWait);
                }

                _refusedUntil = now + RefusedWait;
                return false;

            default:
                return true;
        }
    }

    /// <summary>Holds everything due — or just the standard mail — until a window resets.</summary>
    private async Task HoldDueAsync(
        FoxfireDbContext db,
        IEmailProvider provider,
        EmailPriority? only,
        DateTimeOffset until,
        string reason,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var due = db.EmailMessages
            .Where(m => m.Provider == provider.Name)
            .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held)
            .Where(m => m.NotBefore <= now);

        if (only is { } priority)
        {
            var value = (byte)priority;
            due = due.Where(m => m.Priority == value);
        }

        // The ones newly held, for the chart: a message still held from
        // yesterday is not held again.
        var newly = await due.Where(m => m.Status == EmailStatuses.Queued).Select(m => m.Kind).ToListAsync(cancellationToken);

        var held = await due.ExecuteUpdateAsync(s => s
            .SetProperty(m => m.Status, EmailStatuses.Held)
            .SetProperty(m => m.NotBefore, until)
            .SetProperty(m => m.Reason, reason), cancellationToken);

        foreach (var kind in newly) _metrics.EmailSent(kind, "held");

        if (held > 0)
        {
            _log.LogInformation("Holding {Count} emails until {Until}: {Reason}", held, until, reason);
        }
    }

    /// <summary>
    /// A warning a host should see, once per window: at four fifths of a limit,
    /// and at the limit itself.
    /// </summary>
    private void WarnIfNearLimits(Counts counts)
    {
        Warn("daily", counts.Daily);
        Warn("monthly", counts.Monthly);

        void Warn(string name, EmailWindowState window)
        {
            if (!window.IsCapped) return;

            var full = window.Used >= window.Limit;
            var near = window.Used * 5 >= window.Limit * 4;
            if (!full && !near) return;
            if (!_warned.Add($"{name}:{window.Window.Start:O}:{(full ? "full" : "near")}")) return;

            if (full)
            {
                _log.LogWarning(
                    "Email has reached its {Window} limit of {Limit}; the rest waits until {Until}",
                    name, window.Limit, window.Window.End);
            }
            else
            {
                _log.LogWarning(
                    "Email has used {Used} of its {Window} limit of {Limit}; it resets at {Until}",
                    window.Used, name, window.Limit, window.Window.End);
            }
        }
    }

    private async Task PublishAsync(
        FoxfireDbContext db,
        IEmailProvider provider,
        Counts counts,
        CancellationToken cancellationToken)
    {
        var pending = await db.EmailMessages
            .Where(m => m.Provider == provider.Name)
            .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held || m.Status == EmailStatuses.Sending)
            .GroupBy(m => m.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);

        int Of(string status) => pending.FirstOrDefault(p => p.Status == status)?.Count ?? 0;

        _state.Current = new EmailStateSnapshot(
            provider.Name,
            Of(EmailStatuses.Queued) + Of(EmailStatuses.Sending),
            Of(EmailStatuses.Held),
            counts.Daily.Used,
            counts.Daily.Limit,
            counts.Monthly.Used,
            counts.Monthly.Limit,
            _refusedUntil is { } until && until > _time.GetUtcNow() ? "provider_refused" : null,
            _time.GetUtcNow());
    }

    private static void Requeue(EmailMessage message, DateTimeOffset notBefore, string reason, bool countAttempt)
    {
        message.Status = EmailStatuses.Queued;
        message.NotBefore = notBefore;
        message.Reason = reason;
        message.LeaseUntil = null;
        if (!countAttempt) message.Attempts--;
    }

    private static void Finish(EmailMessage message, string status, string reason)
    {
        message.Status = status;
        message.Reason = reason;
        message.LeaseUntil = null;
    }

    private static async Task<bool> TryLockAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText =
            "DECLARE @result int; "
            + "EXEC @result = sp_getapplock @Resource = @resource, @LockMode = 'Exclusive', "
            + "@LockOwner = 'Session', @LockTimeout = 0; "
            + "SELECT @result;";

        var resource = command.CreateParameter();
        resource.ParameterName = "@resource";
        resource.DbType = DbType.String;
        resource.Value = LockResource;
        command.Parameters.Add(resource);

        var result = await command.ExecuteScalarAsync(cancellationToken);
        return result is int granted && granted >= 0;
    }

    private async Task ReleaseAsync(DbConnection connection)
    {
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = $"EXEC sp_releaseapplock @Resource = '{LockResource}', @LockOwner = 'Session';";
            await command.ExecuteNonQueryAsync();
        }
        catch (DbException ex)
        {
            // The session going away releases it anyway, which is what closing
            // the connection is about to do.
            _log.LogDebug(ex, "Could not release the email dispatch lock explicitly");
        }
    }

    /// <summary>The two windows as a round sees them, kept current as it sends.</summary>
    private sealed class Counts(EmailQuotaReading reading)
    {
        private int _ourDay = reading.Daily.Ours;
        private int _ourMonth = reading.Monthly.Ours;
        private int? _reportedDay = reading.Daily.Reported;
        private int? _reportedMonth = reading.Monthly.Reported;

        public EmailWindowState Daily { get; private set; } = reading.Daily.State;

        public EmailWindowState Monthly { get; private set; } = reading.Monthly.State;

        public void Sent()
        {
            _ourDay++;
            _ourMonth++;
            Refresh();
        }

        public void Observe(QuotaObservation usage)
        {
            if (usage.DailyUsed is { } day) _reportedDay = day;
            if (usage.MonthlyUsed is { } month) _reportedMonth = month;
            Refresh();
        }

        public void Latch(QuotaWindow window, DateTimeOffset until)
        {
            if (window == QuotaWindow.Daily) Daily = Daily with { LatchedUntil = until };
            else Monthly = Monthly with { LatchedUntil = until };
        }

        private void Refresh()
        {
            Daily = Daily with { Used = Math.Max(_ourDay, _reportedDay ?? 0) };
            Monthly = Monthly with { Used = Math.Max(_ourMonth, _reportedMonth ?? 0) };
        }
    }
}
