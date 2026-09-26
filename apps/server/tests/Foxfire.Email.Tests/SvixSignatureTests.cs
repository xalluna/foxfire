using System.Text;
using Foxfire.Email.Resend;

namespace Foxfire.Email.Tests;

public sealed class SvixSignatureTests
{
    // Svix's own worked example, so this is checked against their
    // implementation rather than against itself.
    private const string Secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
    private const string Id = "msg_p5jXN8AQM9LWM0D4loKWxJek";
    private const string Timestamp = "1614265330";
    private const string Expected = "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=";

    private static readonly byte[] Body = Encoding.UTF8.GetBytes("{\"test\": 2432232314}");
    private static readonly DateTimeOffset SentAt = DateTimeOffset.FromUnixTimeSeconds(1614265330);

    [Fact]
    public void Signing_matches_svix() =>
        Assert.Equal(Expected, SvixSignature.Sign(Secret, Id, Timestamp, Body));

    [Fact]
    public void A_matching_signature_is_valid() =>
        Assert.Equal(WebhookVerdict.Valid, SvixSignature.Verify(Secret, Id, Timestamp, Expected, Body, SentAt));

    [Fact]
    public void Any_one_of_several_signatures_is_enough() =>
        Assert.Equal(
            WebhookVerdict.Valid,
            SvixSignature.Verify(Secret, Id, Timestamp, $"v1,bm90IHRoaXMgb25l {Expected}", Body, SentAt));

    [Fact]
    public void A_changed_body_is_refused() =>
        Assert.Equal(
            WebhookVerdict.BadSignature,
            SvixSignature.Verify(Secret, Id, Timestamp, Expected, Encoding.UTF8.GetBytes("{\"test\": 1}"), SentAt));

    [Fact]
    public void Another_secret_is_refused() =>
        Assert.Equal(
            WebhookVerdict.BadSignature,
            SvixSignature.Verify("whsec_" + Convert.ToBase64String(new byte[24]), Id, Timestamp, Expected, Body, SentAt));

    [Theory]
    [InlineData(-6)]
    [InlineData(6)]
    public void A_timestamp_more_than_five_minutes_off_is_stale(int minutes) =>
        Assert.Equal(
            WebhookVerdict.Stale,
            SvixSignature.Verify(Secret, Id, Timestamp, Expected, Body, SentAt.AddMinutes(minutes)));

    [Fact]
    public void Four_minutes_off_is_fine() =>
        Assert.Equal(WebhookVerdict.Valid, SvixSignature.Verify(Secret, Id, Timestamp, Expected, Body, SentAt.AddMinutes(4)));

    [Fact]
    public void Missing_headers_are_missing() =>
        Assert.Equal(WebhookVerdict.Missing, SvixSignature.Verify(Secret, Id, null, Expected, Body, SentAt));

    [Theory]
    [InlineData("v2,abc")]
    [InlineData("nonsense")]
    [InlineData("v1,@@@")]
    public void A_signature_that_is_not_one_is_malformed(string signature) =>
        Assert.Equal(WebhookVerdict.Malformed, SvixSignature.Verify(Secret, Id, Timestamp, signature, Body, SentAt));

    [Theory]
    [InlineData(Secret, true)]
    [InlineData("MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", false)]
    [InlineData("whsec_", false)]
    [InlineData("whsec_***", false)]
    [InlineData("", false)]
    public void A_secret_has_to_look_like_one(string secret, bool wellFormed) =>
        Assert.Equal(wellFormed, SvixSignature.IsWellFormedSecret(secret));
}
