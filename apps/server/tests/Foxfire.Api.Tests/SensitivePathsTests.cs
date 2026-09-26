using Foxfire.Api.Logging;

namespace Foxfire.Api.Tests;

/// <summary>Which paths lose a segment on the way into the logs, and which keep all of theirs.</summary>
public sealed class SensitivePathsTests
{
    [Theory]
    [InlineData("/invite/abc.def", "/invite/{token}")]
    [InlineData("/reset-password/abc.def", "/reset-password/{token}")]
    [InlineData("/verify-email/abc.def", "/verify-email/{token}")]
    [InlineData("/api/invites/abc.def/preview", "/api/invites/{token}/preview")]
    [InlineData("/api/password-resets/abc.def/preview", "/api/password-resets/{token}/preview")]
    [InlineData("/api/password-resets/abc.def/redeem", "/api/password-resets/{token}/redeem")]
    [InlineData("/API/Password-Resets/abc.def/redeem", "/API/Password-Resets/{token}/redeem")]
    public void A_token_segment_is_replaced(string path, string expected) =>
        Assert.Equal(expected, SensitivePaths.Redact(path));

    [Theory]
    [InlineData("/api/password-resets/request")]
    [InlineData("/api/admin/invites/used")]
    [InlineData("/api/search")]
    [InlineData("/invite/")]
    [InlineData("/")]
    [InlineData("")]
    public void Anything_else_is_left_alone(string path) =>
        Assert.Equal(path, SensitivePaths.Redact(path));
}
