namespace Foxfire.Email;

/// <summary>
/// The providers this server knows how to send through, by the name
/// Email__Provider gives them.
///
/// Adding one is an <see cref="IEmailProvider"/> (and, if it has webhooks, an
/// <see cref="IEmailWebhookReceiver"/>), its name here, its options under the
/// Email section, and a keyed registration in Foxfire.Api/Email/EmailServices.cs.
/// </summary>
public static class EmailProviders
{
    public const string Resend = "resend";

    public static IReadOnlyList<string> Known { get; } = [Resend];
}
