using System.Security.Cryptography;
using Foxfire.Core;

namespace Foxfire.Core.Tests;

public class EmailVerificationTokenTests
{
    private static readonly byte[] Key = RandomNumberGenerator.GetBytes(32);
    private static readonly byte[] OtherKey = RandomNumberGenerator.GetBytes(32);
    private static readonly DateTimeOffset Now = new(2026, 9, 26, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_freshly_issued_token_verifies_and_names_its_confirmation()
    {
        var id = Guid.NewGuid();

        var result = EmailVerificationToken.Verify(EmailVerificationToken.Issue(id, Now.AddDays(7), Key), Key, Now);

        Assert.Equal(SignedTokenStatus.Valid, result.Status);
        Assert.Equal(id, result.VerificationId);
    }

    [Fact]
    public void Issuing_twice_gives_the_same_token()
    {
        // What lets a queued email be rebuilt from its row at send time rather
        // than the link being stored anywhere.
        var id = Guid.NewGuid();

        Assert.Equal(
            EmailVerificationToken.Issue(id, Now.AddDays(7), Key),
            EmailVerificationToken.Issue(id, Now.AddDays(7), Key));
    }

    [Fact]
    public void An_expired_token_says_so() =>
        Assert.Equal(
            SignedTokenStatus.Expired,
            EmailVerificationToken.Verify(EmailVerificationToken.Issue(Guid.NewGuid(), Now.AddSeconds(-1), Key), Key, Now).Status);

    [Fact]
    public void A_token_from_another_server_does_not_verify() =>
        Assert.Equal(
            SignedTokenStatus.BadSignature,
            EmailVerificationToken.Verify(EmailVerificationToken.Issue(Guid.NewGuid(), Now.AddDays(7), OtherKey), Key, Now).Status);

    [Fact]
    public void A_confirmation_token_is_not_a_reset_or_an_invite()
    {
        var token = EmailVerificationToken.Issue(Guid.NewGuid(), Now.AddDays(7), Key);

        Assert.Equal(SignedTokenStatus.BadSignature, ResetToken.Verify(token, Key, Now).Status);
        Assert.Equal(SignedTokenStatus.BadSignature, InviteToken.Verify(token, Key, Now).Status);
    }

    [Fact]
    public void Neither_a_reset_nor_an_invite_is_a_confirmation()
    {
        var reset = ResetToken.Issue(Guid.NewGuid(), Now.AddDays(1), Key);
        var invite = InviteToken.Issue(Guid.NewGuid(), Now.AddDays(1), Key);

        Assert.Equal(SignedTokenStatus.BadSignature, EmailVerificationToken.Verify(reset, Key, Now).Status);
        Assert.Equal(SignedTokenStatus.BadSignature, EmailVerificationToken.Verify(invite, Key, Now).Status);
    }

    [Theory]
    [InlineData("")]
    [InlineData("rubbish")]
    [InlineData("a.")]
    public void Nonsense_is_malformed(string token) =>
        Assert.Equal(SignedTokenStatus.Malformed, EmailVerificationToken.Verify(token, Key, Now).Status);
}
