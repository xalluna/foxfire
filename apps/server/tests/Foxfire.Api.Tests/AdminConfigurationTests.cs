using Foxfire.Api.Configuration;

namespace Foxfire.Api.Tests;

/// <summary>
/// The examples .env.example used to ship as values stop the server. The
/// address is the one that matters: whoever registers it becomes head admin,
/// with no proof they own the mailbox, so a server started from the untouched
/// file belonged to anybody who had read it.
/// </summary>
public sealed class AdminConfigurationTests
{
    private static IReadOnlyList<string> Check(string adminEmail, string publicUrl = "https://test.example.com") =>
        ConfigurationCheck.Validate(
            "Server=db;Database=Foxfire",
            new ServerOptions { PublicUrl = publicUrl },
            new RiotOptions { ApiKey = "RGAPI-test" },
            new AuthOptions
            {
                JwtSigningKey = "PSZoLQdDOTJXHJv3fjGEKPI4sMmY9uD0rCtNbVkWaXc=",
                InviteSigningKey = "lRk2yNqTgWv8eBmZ6uAoHx4JdFsCpQ1iXyU3nEwK7Vg="
            },
            new AdminOptions { Email = adminEmail },
            new RateLimitOptions(),
            new LogOptions());

    private static void Refused(IReadOnlyList<string> problems, string setting) =>
        Assert.Contains(problems, p => p.StartsWith(setting, StringComparison.Ordinal));

    [Fact]
    public void An_address_the_host_owns_starts() => Assert.Empty(Check("admin@example.com"));

    [Theory]
    [InlineData("you@example.com")]
    [InlineData("You@Example.com")]
    [InlineData("  you@example.com ")]
    public void The_example_address_is_refused(string address)
    {
        var problems = Check(address);

        Refused(problems, "Admin__Email");
        Assert.Contains(problems, p => p.Contains("become this server's head admin", StringComparison.Ordinal));
    }

    [Fact]
    public void An_address_with_no_at_is_refused() => Refused(Check("owner"), "Admin__Email");

    [Theory]
    [InlineData("https://foxfire.example.com")]
    [InlineData("https://foxfire.example.com/")]
    [InlineData("HTTPS://Foxfire.Example.com")]
    public void The_example_address_for_the_server_is_refused(string url) =>
        Refused(Check("admin@example.com", url), "Server__PublicUrl");

    [Fact]
    public void Another_host_under_the_example_domain_starts() =>
        Assert.Empty(Check("admin@example.com", "https://foxfire.example.org"));
}
