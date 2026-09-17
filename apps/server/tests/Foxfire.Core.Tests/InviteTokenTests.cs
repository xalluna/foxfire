using System.Security.Cryptography;
using Foxfire.Core;

namespace Foxfire.Core.Tests;

public class InviteTokenTests
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);
    private static readonly byte[] OtherKey = RandomNumberGenerator.GetBytes(32);
    private static readonly DateTimeOffset Now = new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

    private static string IssueValid(Guid id) => InviteToken.Issue(id, Now.AddDays(7), Key);

    [Fact]
    public void A_freshly_issued_token_verifies_and_names_its_invite()
    {
        var id = Guid.NewGuid();

        var result = InviteToken.Verify(IssueValid(id), Key, Now);

        Assert.Equal(InviteTokenStatus.Valid, result.Status);
        Assert.Equal(id, result.InviteId);
    }

    [Fact]
    public void The_same_token_verifies_as_many_times_as_it_is_used()
    {
        // The property the whole design turns on: a link that can be clicked any
        // number of times. Spending an invite is a row being written, never the
        // token wearing out — nothing here has any memory of having been asked.
        var token = IssueValid(Guid.NewGuid());

        for (var i = 0; i < 5; i++)
        {
            Assert.Equal(InviteTokenStatus.Valid, InviteToken.Verify(token, Key, Now).Status);
        }
    }

    [Fact]
    public void Issuing_twice_for_the_same_invite_gives_the_same_token()
    {
        // Deterministic: no nonce, no timestamp of its own. An admin who
        // regenerates a link hands out the one already in somebody's inbox
        // rather than quietly invalidating it.
        var id = Guid.NewGuid();
        var expiry = Now.AddDays(7);

        Assert.Equal(InviteToken.Issue(id, expiry, Key), InviteToken.Issue(id, expiry, Key));
    }

    [Fact]
    public void An_expired_token_is_expired()
    {
        var token = InviteToken.Issue(Guid.NewGuid(), Now.AddDays(-1), Key);

        Assert.Equal(InviteTokenStatus.Expired, InviteToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void Expiry_is_exclusive_at_the_boundary()
    {
        var token = InviteToken.Issue(Guid.NewGuid(), Now, Key);

        Assert.Equal(InviteTokenStatus.Expired, InviteToken.Verify(token, Key, Now).Status);
        Assert.Equal(InviteTokenStatus.Valid, InviteToken.Verify(token, Key, Now.AddSeconds(-1)).Status);
    }

    [Fact]
    public void A_token_from_another_server_does_not_verify_here()
    {
        var token = InviteToken.Issue(Guid.NewGuid(), Now.AddDays(7), OtherKey);

        Assert.Equal(InviteTokenStatus.BadSignature, InviteToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void A_tampered_payload_fails_the_signature_not_the_expiry()
    {
        // Somebody pushing their own expiry out must not get "expired" or
        // "valid" — they must get "this is not one of ours".
        var token = IssueValid(Guid.NewGuid());
        var parts = token.Split('.');
        var tampered = $"{Flip(parts[0])}.{parts[1]}";

        Assert.Equal(InviteTokenStatus.BadSignature, InviteToken.Verify(tampered, Key, Now).Status);
    }

    [Fact]
    public void A_tampered_signature_fails()
    {
        var token = IssueValid(Guid.NewGuid());
        var parts = token.Split('.');
        var tampered = $"{parts[0]}.{Flip(parts[1])}";

        Assert.Equal(InviteTokenStatus.BadSignature, InviteToken.Verify(tampered, Key, Now).Status);
    }

    [Fact]
    public void A_rejected_token_never_reports_an_invite_id()
    {
        // Nothing downstream should be able to act on an id that failed to
        // verify, so the failing paths hand back Guid.Empty rather than
        // whatever the unverified bytes happened to say.
        var parts = IssueValid(Guid.NewGuid()).Split('.');
        var forged = $"{parts[0]}.{Flip(parts[1])}";

        Assert.Equal(Guid.Empty, InviteToken.Verify(forged, Key, Now).InviteId);
        Assert.Equal(Guid.Empty, InviteToken.Verify("rubbish", Key, Now).InviteId);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("no-dot-at-all")]
    [InlineData(".only-a-signature")]
    [InlineData("only-a-payload.")]
    [InlineData("a.b")]
    [InlineData("!!!.???")]
    public void Rubbish_is_malformed_rather_than_an_exception(string? token)
    {
        // A token is attacker-supplied. Every path through Verify has to end in
        // a verdict — an exception here is a 500 on an unauthenticated route.
        Assert.Equal(InviteTokenStatus.Malformed, InviteToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void A_truncated_token_is_malformed()
    {
        var token = IssueValid(Guid.NewGuid());

        Assert.Equal(InviteTokenStatus.Malformed, InviteToken.Verify(token[..^4], Key, Now).Status);
    }

    [Fact]
    public void Tokens_are_url_safe()
    {
        // They travel in links. Anything needing percent-encoding would survive
        // a copy-paste into Discord and not a redirect.
        for (var i = 0; i < 200; i++)
        {
            var token = InviteToken.Issue(Guid.NewGuid(), Now.AddDays(7), Key);

            Assert.DoesNotContain('+', token);
            Assert.DoesNotContain('/', token);
            Assert.DoesNotContain('=', token);
            Assert.Equal(Uri.EscapeDataString(token), token);
        }
    }

    /// <summary>Flips one character so the bytes differ but the length does not.</summary>
    private static string Flip(string part)
    {
        var chars = part.ToCharArray();
        chars[0] = chars[0] == 'A' ? 'B' : 'A';
        return new string(chars);
    }
}
