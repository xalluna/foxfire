using System.Text;
using Foxfire.Email.Resend;

namespace Foxfire.Email.Tests;

public sealed class ResendWebhookParserTests
{
    private static IReadOnlyList<EmailDeliveryEvent> Parse(string json) =>
        ResendWebhookParser.Parse(Encoding.UTF8.GetBytes(json));

    private static string Event(string type, string id) =>
        "{\"type\":\"" + type + "\",\"data\":{\"email_id\":\"" + id + "\"}}";

    [Fact]
    public void A_delivery_names_the_message_and_when()
    {
        var delivered = Assert.Single(Parse("""
            {"type":"email.delivered","created_at":"2026-09-26T12:00:01.000Z",
             "data":{"email_id":"re-1","to":["a@example.com"],"subject":"Hi"}}
            """));

        Assert.Equal("re-1", delivered.ProviderMessageId);
        Assert.Equal(EmailDeliveryEventKind.Delivered, delivered.Kind);
        Assert.Equal(new DateTimeOffset(2026, 9, 26, 12, 0, 1, TimeSpan.Zero), delivered.At);
        Assert.False(delivered.Permanent);
    }

    [Fact]
    public void A_permanent_bounce_is_hard()
    {
        var bounce = Assert.Single(Parse("""
            {"type":"email.bounced","created_at":"2026-09-26T12:00:01Z",
             "data":{"email_id":"re-2","bounce":{"type":"Permanent","subType":"General","message":"No such user"}}}
            """));

        Assert.Equal(EmailDeliveryEventKind.Bounced, bounce.Kind);
        Assert.True(bounce.Permanent);
        Assert.Equal("Permanent · General · No such user", bounce.Detail);
    }

    [Fact]
    public void A_transient_bounce_is_soft()
    {
        var bounce = Assert.Single(Parse("""
            {"type":"email.bounced","data":{"email_id":"re-3","bounce":{"type":"Transient","subType":"MailboxFull"}}}
            """));

        Assert.False(bounce.Permanent);
    }

    [Theory]
    [InlineData("email.sent", EmailDeliveryEventKind.Sent)]
    [InlineData("email.delivery_delayed", EmailDeliveryEventKind.Delayed)]
    [InlineData("email.complained", EmailDeliveryEventKind.Complained)]
    [InlineData("email.failed", EmailDeliveryEventKind.Failed)]
    [InlineData("email.suppressed", EmailDeliveryEventKind.Suppressed)]
    public void Every_tracked_event_is_read(string type, EmailDeliveryEventKind kind) =>
        Assert.Equal(kind, Assert.Single(Parse(Event(type, "re-4"))).Kind);

    [Theory]
    [InlineData("email.opened")]
    [InlineData("email.clicked")]
    [InlineData("domain.updated")]
    [InlineData("contact.created")]
    public void Anything_untracked_is_ignored(string type) =>
        Assert.Empty(Parse(Event(type, "re-5")));

    [Theory]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"type":"email.delivered"}""")]
    [InlineData("""{"type":"email.delivered","data":{}}""")]
    public void A_body_that_says_nothing_usable_is_nothing(string json) =>
        Assert.Empty(Parse(json));
}
