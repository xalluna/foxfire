using Foxfire.Api.Configuration;
using Foxfire.Email;
using Microsoft.Extensions.Options;

namespace Foxfire.Api.Email;

/// <summary>
/// The one provider Email__Provider names, or none.
///
/// Every provider the server knows is registered, keyed by name; this picks the
/// configured one out, once, the first time anybody asks. Lazily, and through
/// <see cref="IOptions{TOptions}"/> rather than a value read at boot, so that a
/// test host can turn mail on for itself with configuration of its own.
/// </summary>
public sealed class ActiveEmailProvider
{
    private readonly IServiceProvider _services;
    private readonly IOptions<EmailOptions> _options;
    private readonly IOptions<ServerOptions> _server;
    private readonly Lazy<IEmailProvider?> _provider;

    public ActiveEmailProvider(IServiceProvider services, IOptions<EmailOptions> options, IOptions<ServerOptions> server)
    {
        _services = services;
        _options = options;
        _server = server;
        _provider = new Lazy<IEmailProvider?>(() => options.Value.IsEnabled
            ? services.GetKeyedService<IEmailProvider>(options.Value.ProviderName)
            : null);
    }

    /// <summary>The provider mail goes through, or null when this server sends none.</summary>
    public IEmailProvider? Provider => _provider.Value;

    public bool IsEnabled => Provider is not null;

    public EmailOptions Options => _options.Value;

    /// <summary>The webhook receiver for a provider, when it is the active one and has a secret to check with.</summary>
    public IEmailWebhookReceiver? ReceiverFor(string name)
    {
        if (Provider is not { } provider) return null;
        if (!string.Equals(provider.Name, name, StringComparison.OrdinalIgnoreCase)) return null;

        return _services.GetKeyedService<IEmailWebhookReceiver>(provider.Name) is { CanVerify: true } receiver
            ? receiver
            : null;
    }

    /// <summary>Whether the active provider can tell the server what became of a message.</summary>
    public bool TracksDelivery => Provider is { } provider && ReceiverFor(provider.Name) is not null;

    /// <summary>The name mail is signed with: Email__FromName, or the server's own.</summary>
    public string SenderName =>
        string.IsNullOrWhiteSpace(Options.FromName) ? _server.Value.Name : Options.FromName.Trim();

    /// <summary>The From line, as <see cref="FromLine"/> spells it.</summary>
    public string From => FromLine(SenderName, Options.FromAddress.Trim());

    /// <summary>
    /// <c>Name &lt;address&gt;</c>, never with the name in quotes.
    ///
    /// Quoting is how RFC 5322 carries a name with a comma in it, but Resend
    /// drops a quoted name: Server 0.5.0 sent <c>"noreply" &lt;…&gt;</c> and
    /// the mail arrived from the bare address. So the name goes unquoted, the
    /// way Resend's own docs write it, and loses whatever would have needed the
    /// quotes — the specials, and anything that could end the header — rather
    /// than the whole name. The period stays: every client reads it unquoted.
    /// </summary>
    public static string FromLine(string name, string address)
    {
        ArgumentNullException.ThrowIfNull(name);
        ArgumentNullException.ThrowIfNull(address);

        var kept = name.Select(c => c is '(' or ')' or '<' or '>' or '[' or ']' or ':' or ';' or '@' or '\\' or ',' or '"' || char.IsWhiteSpace(c) ? ' ' : c);
        var words = new string([.. kept]).Split(' ', StringSplitOptions.RemoveEmptyEntries);

        return words.Length == 0 ? address : $"{string.Join(' ', words)} <{address}>";
    }
}
