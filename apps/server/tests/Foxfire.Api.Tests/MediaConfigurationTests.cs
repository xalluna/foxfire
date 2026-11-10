using Foxfire.Api.Configuration;

namespace Foxfire.Api.Tests;

/// <summary>
/// Recordings are optional, and a half-configured Foxfire Media stops the
/// server — it would otherwise refuse every upload while the host believed it worked.
/// </summary>
public sealed class MediaConfigurationTests
{
    private static IReadOnlyList<string> Check(MediaOptions media) =>
        ConfigurationCheck.Validate(
            "Server=db;Database=Foxfire",
            new ServerOptions { PublicUrl = "https://test.example.com" },
            new RiotOptions { ApiKey = "RGAPI-test" },
            new AuthOptions
            {
                JwtSigningKey = "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=",
                InviteSigningKey = "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg="
            },
            new AdminOptions { Email = "admin@example.com" },
            new RateLimitOptions(),
            new LogOptions(),
            new TelemetryOptions(),
            new EmailOptions(),
            media);

    private static void Refused(MediaOptions media, string setting) =>
        Assert.Contains(Check(media), p => p.StartsWith(setting, StringComparison.Ordinal));

    [Fact]
    public void No_media_starts() => Assert.Empty(Check(new MediaOptions()));

    [Theory]
    [InlineData("https://media.example.com")]
    [InlineData("http://localhost:8080")]
    [InlineData("http://192.168.1.75:8080")]
    [InlineData("http://10.0.0.4")]
    [InlineData("http://foxfire-media:8080")]
    [InlineData("http://host.docker.internal:5580")]
    public void A_url_and_a_key_start(string url) =>
        Assert.Empty(Check(new MediaOptions { BaseUrl = url, ApiKey = "key" }));

    [Fact]
    public void A_url_without_a_key_is_refused() =>
        Refused(new MediaOptions { BaseUrl = "https://media.example.com" }, "Media__ApiKey");

    [Fact]
    public void A_key_without_a_url_is_refused() => Refused(new MediaOptions { ApiKey = "key" }, "Media__BaseUrl");

    [Fact]
    public void Plain_http_across_the_internet_is_refused() =>
        Refused(new MediaOptions { BaseUrl = "http://media.example.com", ApiKey = "key" }, "Media__BaseUrl");

    [Fact]
    public void A_public_address_across_the_internet_has_to_be_https() =>
        Refused(
            new MediaOptions { BaseUrl = "http://foxfire-media:8080", ApiKey = "key", PublicUrl = "http://media.example.com" },
            "Media__PublicUrl");

    [Fact]
    public void Something_that_is_not_a_url_is_refused() =>
        Refused(new MediaOptions { BaseUrl = "media.example.com", ApiKey = "key" }, "Media__BaseUrl");

    [Fact]
    public void An_embed_lifetime_foxfire_media_would_not_keep_is_refused() =>
        Refused(
            new MediaOptions { BaseUrl = "https://media.example.com", ApiKey = "key", EmbedLifetime = TimeSpan.FromMinutes(1) },
            "Media__EmbedLifetime");
}
