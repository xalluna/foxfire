using System.Security.Cryptography;
using Foxfire.Core;

namespace Foxfire.Core.Tests;

public class ResetTokenTests
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);
    private static readonly byte[] OtherKey = RandomNumberGenerator.GetBytes(32);
    private static readonly DateTimeOffset Now = new(2026, 9, 22, 12, 0, 0, TimeSpan.Zero);

    private static string IssueValid(Guid id) => ResetToken.Issue(id, Now.AddHours(24), Key);

    [Fact]
    public void A_freshly_issued_token_verifies_and_names_its_reset()
    {
        var id = Guid.NewGuid();

        var result = ResetToken.Verify(IssueValid(id), Key, Now);

        Assert.Equal(SignedTokenStatus.Valid, result.Status);
        Assert.Equal(id, result.ResetId);
    }

    [Fact]
    public void Issuing_twice_for_the_same_reset_gives_the_same_token()
    {
        // Deterministic, like an invite's, which is what lets an admin copy the
        // same link again tomorrow rather than having to make a new one.
        var id = Guid.NewGuid();
        var expiry = Now.AddHours(24);

        Assert.Equal(ResetToken.Issue(id, expiry, Key), ResetToken.Issue(id, expiry, Key));
    }

    [Fact]
    public void An_expired_token_says_so_rather_than_failing_its_signature()
    {
        var token = ResetToken.Issue(Guid.NewGuid(), Now.AddHours(-1), Key);

        Assert.Equal(SignedTokenStatus.Expired, ResetToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void Expiry_is_exclusive_at_the_boundary()
    {
        var token = ResetToken.Issue(Guid.NewGuid(), Now, Key);

        Assert.Equal(SignedTokenStatus.Expired, ResetToken.Verify(token, Key, Now).Status);
        Assert.Equal(SignedTokenStatus.Valid, ResetToken.Verify(token, Key, Now.AddSeconds(-1)).Status);
    }

    [Fact]
    public void A_token_from_another_server_does_not_verify()
    {
        var token = ResetToken.Issue(Guid.NewGuid(), Now.AddHours(24), OtherKey);

        Assert.Equal(SignedTokenStatus.BadSignature, ResetToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void A_tampered_payload_does_not_verify()
    {
        var token = IssueValid(Guid.NewGuid());
        var parts = token.Split('.');
        var tampered = $"{parts[0][..^1]}{(parts[0][^1] == 'A' ? 'B' : 'A')}.{parts[1]}";

        Assert.Equal(SignedTokenStatus.BadSignature, ResetToken.Verify(tampered, Key, Now).Status);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("rubbish")]
    [InlineData(".")]
    [InlineData("a.")]
    [InlineData(".b")]
    public void Nonsense_is_malformed_rather_than_an_exception(string token)
    {
        var result = ResetToken.Verify(token, Key, Now);

        Assert.Equal(SignedTokenStatus.Malformed, result.Status);
        Assert.Equal(Guid.Empty, result.ResetId);
    }

    [Fact]
    public void An_invite_token_is_not_a_reset_token()
    {
        // The two kinds of link are the same shape and rest on the same
        // configured secret, so this is the test that the separation is real: a
        // reset signs with a key derived from the invite key, and neither kind
        // verifies as the other even for the same id and expiry.
        var id = Guid.NewGuid();
        var expiry = Now.AddHours(24);

        var invite = InviteToken.Issue(id, expiry, Key);
        var reset = ResetToken.Issue(id, expiry, Key);

        Assert.NotEqual(invite, reset);
        Assert.Equal(SignedTokenStatus.BadSignature, ResetToken.Verify(invite, Key, Now).Status);
        Assert.Equal(SignedTokenStatus.BadSignature, InviteToken.Verify(reset, Key, Now).Status);
    }

    [Fact]
    public void Tokens_survive_a_URL_without_escaping()
    {
        for (var i = 0; i < 200; i++)
        {
            var token = ResetToken.Issue(Guid.NewGuid(), Now.AddHours(24), Key);

            Assert.Equal(token, Uri.EscapeDataString(token));
        }
    }
}
