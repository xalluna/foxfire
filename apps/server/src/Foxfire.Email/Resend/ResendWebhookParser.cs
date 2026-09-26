using System.Globalization;
using System.Text.Json;

namespace Foxfire.Email.Resend;

/// <summary>
/// What a Resend webhook body says happened.
///
/// One event per body: <c>{ "type": "email.bounced", "created_at": …, "data":
/// { "email_id": …, "bounce": { "type": "Permanent", … } } }</c>. Opens and
/// clicks are ignored — this server does not track them, and would not have
/// them unless a host turned tracking on for their domain — as is every event
/// that is not about an email.
///
/// A body that does not parse is an empty list rather than an exception. It has
/// already passed the signature check, so it came from Resend; a shape this
/// code does not know is Resend adding something, not somebody attacking.
/// </summary>
public static class ResendWebhookParser
{
    public static IReadOnlyList<EmailDeliveryEvent> Parse(ReadOnlySpan<byte> body)
    {
        try
        {
            var reader = new Utf8JsonReader(body);
            using var document = JsonDocument.ParseValue(ref reader);
            var root = document.RootElement;

            if (root.ValueKind != JsonValueKind.Object) return [];

            var type = Text(root, "type");
            if (KindOf(type) is not { } kind) return [];

            if (!root.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) return [];
            if (Text(data, "email_id") is not { Length: > 0 } id) return [];

            var at = Time(Text(root, "created_at")) ?? Time(Text(data, "created_at")) ?? DateTimeOffset.UtcNow;

            var permanent = false;
            string? detail = null;

            if (kind == EmailDeliveryEventKind.Bounced && data.TryGetProperty("bounce", out var bounce)
                && bounce.ValueKind == JsonValueKind.Object)
            {
                permanent = string.Equals(Text(bounce, "type"), "Permanent", StringComparison.OrdinalIgnoreCase);
                detail = Join(Text(bounce, "type"), Text(bounce, "subType"), Text(bounce, "message"));
            }
            else if (kind == EmailDeliveryEventKind.Failed && data.TryGetProperty("failed", out var failed)
                     && failed.ValueKind == JsonValueKind.Object)
            {
                detail = Text(failed, "reason");
            }
            else if (kind == EmailDeliveryEventKind.Suppressed && data.TryGetProperty("suppressed", out var suppressed)
                     && suppressed.ValueKind == JsonValueKind.Object)
            {
                detail = Join(Text(suppressed, "type"), Text(suppressed, "message"));
            }

            return [new EmailDeliveryEvent(id, kind, at, permanent, Truncate(detail))];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static EmailDeliveryEventKind? KindOf(string? type) => type switch
    {
        "email.sent" => EmailDeliveryEventKind.Sent,
        "email.delivered" => EmailDeliveryEventKind.Delivered,
        "email.delivery_delayed" => EmailDeliveryEventKind.Delayed,
        "email.bounced" => EmailDeliveryEventKind.Bounced,
        "email.complained" => EmailDeliveryEventKind.Complained,
        "email.failed" => EmailDeliveryEventKind.Failed,
        "email.suppressed" => EmailDeliveryEventKind.Suppressed,
        _ => null
    };

    private static string? Text(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static DateTimeOffset? Time(string? text) =>
        DateTimeOffset.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var at)
            ? at
            : null;

    private static string? Join(params string?[] parts)
    {
        var present = parts.Where(p => !string.IsNullOrWhiteSpace(p)).ToList();
        return present.Count == 0 ? null : string.Join(" · ", present);
    }

    private static string? Truncate(string? text) => text is { Length: > 500 } ? text[..500] : text;
}
