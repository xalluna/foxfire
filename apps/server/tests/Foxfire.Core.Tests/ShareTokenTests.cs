using System.Security.Cryptography;
using Foxfire.Core;

namespace Foxfire.Core.Tests;

public class ShareTokenTests
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);
    private static readonly DateTimeOffset Now = new(2026, 10, 29, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_freshly_issued_token_verifies_and_names_its_link()
    {
        var id = Guid.NewGuid();

        var result = ShareToken.Verify(ShareToken.Issue(id, Now.AddDays(7), Key), Key, Now);

        Assert.Equal(SignedTokenStatus.Valid, result.Status);
        Assert.Equal(id, result.ShareLinkId);
        Assert.Equal(Now.AddDays(7), result.ExpiresAt);
    }

    [Fact]
    public void Issuing_twice_for_the_same_link_gives_the_same_token()
    {
        // What lets a member copy the same link again rather than mint another.
        var id = Guid.NewGuid();

        Assert.Equal(ShareToken.Issue(id, Now.AddDays(7), Key), ShareToken.Issue(id, Now.AddDays(7), Key));
    }

    [Fact]
    public void A_lapsed_token_says_so()
    {
        var token = ShareToken.Issue(Guid.NewGuid(), Now.AddMinutes(-1), Key);

        Assert.Equal(SignedTokenStatus.Expired, ShareToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void A_share_link_is_never_an_invite_or_a_reset_and_neither_is_ever_a_share_link()
    {
        // All three are signed from the one invite key; each under its own label.
        var id = Guid.NewGuid();
        var expiry = Now.AddDays(7);

        var share = ShareToken.Issue(id, expiry, Key);

        Assert.Equal(SignedTokenStatus.BadSignature, InviteToken.Verify(share, Key, Now).Status);
        Assert.Equal(SignedTokenStatus.BadSignature, ResetToken.Verify(share, Key, Now).Status);
        Assert.Equal(SignedTokenStatus.BadSignature, ShareToken.Verify(InviteToken.Issue(id, expiry, Key), Key, Now).Status);
        Assert.Equal(SignedTokenStatus.BadSignature, ShareToken.Verify(ResetToken.Issue(id, expiry, Key), Key, Now).Status);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-token")]
    [InlineData("abc.def")]
    public void Anything_else_is_malformed(string? token) =>
        Assert.Equal(SignedTokenStatus.Malformed, ShareToken.Verify(token, Key, Now).Status);
}
