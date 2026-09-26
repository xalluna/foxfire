using Foxfire.Api.Configuration;
using Foxfire.Data;
using Foxfire.Data.Entities;
using Foxfire.Email;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Email;

/// <summary>
/// Where a feature puts an email it wants sent.
///
/// A message is added to the caller's own DbContext and saved with whatever it
/// is about — the invite and the mail carrying it commit together or not at
/// all, so there is never an invite whose mail was lost on the way, nor mail
/// about an invite that was rolled back. The dispatcher sends it; nothing here
/// talks to a provider.
///
/// On a server with no provider, <see cref="AddAsync"/> adds nothing and says
/// so, and every feature carries on as it did before the server could send
/// mail.
/// </summary>
public sealed class EmailOutbox
{
    private readonly FoxfireDbContext _db;
    private readonly ActiveEmailProvider _active;
    private readonly EmailSignal _signal;
    private readonly TimeProvider _time;
    private readonly IOptions<ServerOptions> _server;
    private bool _listening;

    public EmailOutbox(
        FoxfireDbContext db,
        ActiveEmailProvider active,
        EmailSignal signal,
        TimeProvider time,
        IOptions<ServerOptions> server)
    {
        _db = db;
        _active = active;
        _signal = signal;
        _time = time;
        _server = server;
    }

    public bool IsEnabled => _active.IsEnabled;

    /// <summary>
    /// Queues a message, to be saved with the caller's next SaveChanges.
    ///
    /// A suppressed address is still written down — as dropped, so the admin
    /// lists can say why nothing arrived — but nothing is sent to it.
    /// </summary>
    /// <param name="worthlessAfter">When the link it carries stops working. It is dropped rather than sent after that.</param>
    /// <returns>The message, or null when this server sends no mail.</returns>
    public async Task<EmailMessage?> AddAsync(
        string kind,
        EmailPriority priority,
        string recipient,
        Guid? relatedId,
        Guid? userId,
        Guid? triggeredBy,
        DateTimeOffset worthlessAfter,
        CancellationToken cancellationToken)
    {
        if (_active.Provider is not { } provider) return null;

        var now = _time.GetUtcNow();
        var address = recipient.Trim();
        var suppressed = await IsSuppressedAsync(address, cancellationToken);

        var message = new EmailMessage
        {
            Id = Guid.CreateVersion7(now),
            Kind = kind,
            Priority = (byte)priority,
            Provider = provider.Name,
            Recipient = address,
            Subject = Clip(EmailTemplates.Subject(kind, _server.Value.Name), 200),
            Status = suppressed ? EmailStatuses.Dropped : EmailStatuses.Queued,
            Reason = suppressed ? "suppressed" : null,
            TriggeredByUserId = triggeredBy,
            UserId = userId,
            RelatedId = relatedId,
            CreatedAt = now,
            NotBefore = now,
            WorthlessAfter = worthlessAfter
        };

        _db.EmailMessages.Add(message);
        WakeAfterSave();

        return message;
    }

    /// <summary>
    /// Withdraws whatever mail about <paramref name="relatedId"/> has not gone
    /// yet — the invite was withdrawn, the reset replaced. The dispatcher would
    /// drop it anyway when its turn came; this is so the admin lists say so now.
    /// </summary>
    public Task<int> WithdrawAsync(string kind, Guid relatedId, string reason, CancellationToken cancellationToken) =>
        _db.EmailMessages
            .Where(m => m.Kind == kind && m.RelatedId == relatedId)
            .Where(m => m.Status == EmailStatuses.Queued || m.Status == EmailStatuses.Held)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.Status, EmailStatuses.Dropped)
                .SetProperty(m => m.Reason, reason), cancellationToken);

    /// <summary>
    /// Tells a member their password has changed, if they have an address that
    /// has been confirmed — a notice to an address nobody has shown they read
    /// would tell a stranger the account exists. Saved at once.
    /// </summary>
    public async Task NotifyPasswordChangedAsync(FoxfireUser user, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(user);
        if (!user.EmailConfirmed || string.IsNullOrWhiteSpace(user.Email)) return;

        var queued = await AddAsync(
            EmailKinds.PasswordChanged,
            EmailPriority.Security,
            user.Email,
            relatedId: null,
            userId: user.Id,
            triggeredBy: user.Id,
            worthlessAfter: _time.GetUtcNow().AddDays(7),
            cancellationToken);

        if (queued is not null) await _db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>Whether mail to this address has been stopped after a bounce or a complaint.</summary>
    public Task<bool> IsSuppressedAsync(string address, CancellationToken cancellationToken)
    {
        var normalized = EmailSuppression.Normalize(address);
        return _db.EmailSuppressions.AnyAsync(s => s.Address == normalized, cancellationToken);
    }

    /// <summary>
    /// Tells the dispatcher to look now. Saving does this by itself; this is for
    /// a caller whose save was inside a transaction, which the dispatcher cannot
    /// see until it commits.
    /// </summary>
    public void Wake() => _signal.Poke();

    private void WakeAfterSave()
    {
        if (_listening) return;

        _listening = true;
        _db.SavedChanges += (_, _) => _signal.Poke();
    }

    private static string Clip(string text, int length) => text.Length <= length ? text : text[..length];
}
