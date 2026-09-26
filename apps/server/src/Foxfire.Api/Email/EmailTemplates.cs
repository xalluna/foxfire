using System.Globalization;
using System.Net;
using System.Text;
using Foxfire.Data.Entities;

namespace Foxfire.Api.Email;

/// <summary>A message's two bodies. Every message has a plain-text one, for the clients that want it.</summary>
public sealed record EmailContent(string Html, string Text);

/// <summary>
/// What each kind of email says.
///
/// Raw strings rather than a template engine: there are six of them, each a
/// heading, a line or two and at most one button, and a dependency to render
/// that would be more to read than they are.
///
/// Two rules hold for all of them. Every value is encoded before it reaches the
/// HTML — a username or a server name is whatever somebody typed. And nothing
/// here reads the clock or anything else that can change between one attempt
/// and the next: a retry is sent under the same idempotency key, and the
/// provider refuses a key reused with a different body. Times come from the
/// rows, in UTC, spelled the same way every time.
/// </summary>
internal static class EmailTemplates
{
    // The brand's navy and ice-blue, from packages/ui's tokens.
    private const string Navy = "#0a1428";
    private const string Ice = "#9dc8ff";
    private const string Parchment = "#f0e6d2";
    private const string Ink = "#1c2433";
    private const string Muted = "#6b7280";
    private const string LinkBlue = "#3e5f8a";

    public static string Subject(string kind, string server) => kind switch
    {
        EmailKinds.Invite => $"You're invited to {server}",
        EmailKinds.PasswordReset => $"Reset your {server} password",
        EmailKinds.Verification => $"Confirm your email for {server}",
        EmailKinds.EmailChange => $"Confirm your new email for {server}",
        EmailKinds.PasswordChanged => $"Your {server} password was changed",
        EmailKinds.Test => $"A test email from {server}",
        _ => server
    };

    public static EmailContent Invite(string server, string link, DateTimeOffset expiresAt) => Layout(
        server,
        Subject(EmailKinds.Invite, server),
        $"You're invited to {server}",
        [
            $"Somebody on {server} has invited you to join them on Foxfire — match history, ranks and replays for the people you play League with.",
            $"The invitation works until {When(expiresAt)}."
        ],
        ("Accept the invitation", link),
        "You're getting this because an admin of this Foxfire server entered your address. If you weren't expecting it, you can ignore it — nothing happens unless you open the link.");

    public static EmailContent PasswordReset(
        string server,
        string username,
        string link,
        DateTimeOffset expiresAt,
        bool requestedByMember) => Layout(
        server,
        Subject(EmailKinds.PasswordReset, server),
        "Reset your password",
        [
            requestedByMember
                ? $"Somebody — hopefully you — asked to reset the password for {username} on {server}."
                : $"An admin of {server} made a password reset link for {username}.",
            $"The link sets a new password and signs you in. It works once, until {When(expiresAt)}. Your current password keeps working until then."
        ],
        ("Choose a new password", link),
        "If you didn't ask for this, you can ignore it: nothing about your account has changed.");

    public static EmailContent Verification(string server, string address, string link, DateTimeOffset expiresAt) => Layout(
        server,
        Subject(EmailKinds.Verification, server),
        "Confirm your email",
        [
            $"Confirm that {address} is yours, so {server} can send you a reset link if you ever forget your password.",
            $"The link works until {When(expiresAt)}."
        ],
        ("Confirm my email", link),
        "You're getting this because this address was used for an account on this Foxfire server. If that wasn't you, ignore it.");

    public static EmailContent EmailChange(string server, string username, string address, string link, DateTimeOffset expiresAt) => Layout(
        server,
        Subject(EmailKinds.EmailChange, server),
        "Confirm your new email",
        [
            $"{username} asked to sign in to {server} with {address} from now on.",
            $"Confirm it and this becomes the address you sign in with. Until then, the old one still works. The link works until {When(expiresAt)}."
        ],
        ("Confirm the new address", link),
        "If you didn't ask for this, ignore it: the account keeps its current address.");

    public static EmailContent PasswordChanged(string server, DateTimeOffset at, string forgotLink) => Layout(
        server,
        Subject(EmailKinds.PasswordChanged, server),
        "Your password was changed",
        [
            $"The password for your account on {server} was changed at {When(at)}, and every other device was signed out.",
            "If that was you, there's nothing to do. If it wasn't, reset your password now and tell an admin of the server."
        ],
        ("Reset my password", forgotLink),
        "You're getting this because it's a change to your account's security.");

    public static EmailContent Test(string server, DateTimeOffset at) => Layout(
        server,
        Subject(EmailKinds.Test, server),
        "This is a test",
        [
            $"A head admin of {server} sent this at {When(at)} to check that mail from the server arrives.",
            "It did. There's nothing to do."
        ],
        null,
        "You're getting this because a head admin of this Foxfire server entered your address on its Email page.");

    /// <summary>Always the same spelling, always UTC: <c>Sat 26 Sep 2026, 14:05 UTC</c>.</summary>
    public static string When(DateTimeOffset at) =>
        at.ToUniversalTime().ToString("ddd d MMM yyyy, HH:mm 'UTC'", CultureInfo.InvariantCulture);

    private static EmailContent Layout(
        string server,
        string title,
        string heading,
        IReadOnlyList<string> paragraphs,
        (string Label, string Link)? button,
        string footer)
    {
        var html = new StringBuilder();

        html.Append($$"""
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>{{Encode(title)}}</title>
            </head>
            <body style="margin:0;padding:0;background:#eef1f6;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f6;padding:24px 12px;">
            <tr><td align="center">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:8px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:{{Ink}};">
            <tr><td style="background:{{Navy}};padding:16px 24px;color:{{Parchment}};font-size:15px;font-weight:600;letter-spacing:0.02em;">{{Encode(server)}}</td></tr>
            <tr><td style="padding:28px 24px 8px;">
            <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:{{Navy}};">{{Encode(heading)}}</h1>

            """);

        foreach (var paragraph in paragraphs)
        {
            html.Append($$"""<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">{{Encode(paragraph)}}</p>""").Append('\n');
        }

        html.Append("</td></tr>\n");

        if (button is { } action)
        {
            html.Append($$"""
                <tr><td style="padding:8px 24px 20px;">
                <a href="{{Encode(action.Link)}}" style="display:inline-block;background:{{Navy}};color:{{Ice}};text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:6px;">{{Encode(action.Label)}}</a>
                <p style="margin:16px 0 0;font-size:12px;line-height:1.5;color:{{Muted}};">Or paste this into your browser:<br><a href="{{Encode(action.Link)}}" style="color:{{LinkBlue}};word-break:break-all;">{{Encode(action.Link)}}</a></p>
                </td></tr>

                """);
        }

        html.Append($$"""
            <tr><td style="padding:16px 24px 24px;font-size:12px;line-height:1.5;color:{{Muted}};border-top:1px solid #e5e7eb;">{{Encode(footer)}}</td></tr>
            </table>
            </td></tr>
            </table>
            </body>
            </html>
            """);

        var text = new StringBuilder()
            .Append(heading).Append("\n\n");

        foreach (var paragraph in paragraphs) text.Append(paragraph).Append("\n\n");

        if (button is { } link) text.Append(link.Label).Append(":\n").Append(link.Link).Append("\n\n");

        text.Append("— ").Append(server).Append("\n\n").Append(footer).Append('\n');

        return new EmailContent(html.ToString(), text.ToString());
    }

    private static string Encode(string value) => WebUtility.HtmlEncode(value);
}
