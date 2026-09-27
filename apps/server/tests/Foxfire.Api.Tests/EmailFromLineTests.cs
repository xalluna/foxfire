using Foxfire.Api.Email;

namespace Foxfire.Api.Tests;

/// <summary>
/// The From line goes to Resend unquoted, because Resend drops a quoted name
/// and the mail arrives from a bare address. A name that would need the quotes
/// loses the punctuation that needs them, never the whole name.
/// </summary>
public sealed class EmailFromLineTests
{
    private const string Address = "noreply@mail.example.com";

    [Theory]
    [InlineData("Foxfire", "Foxfire <noreply@mail.example.com>")]
    [InlineData("The Fox Den", "The Fox Den <noreply@mail.example.com>")]
    [InlineData("  Fox   Den  ", "Fox Den <noreply@mail.example.com>")]
    [InlineData("Fox, Den", "Fox Den <noreply@mail.example.com>")]
    [InlineData("\"Foxfire\"", "Foxfire <noreply@mail.example.com>")]
    [InlineData("Fox <den@evil.example>", "Fox den evil.example <noreply@mail.example.com>")]
    [InlineData("Fox\r\nBcc: someone@example.com", "Fox Bcc someone example.com <noreply@mail.example.com>")]
    [InlineData("Fox\\Den (EUW): [1];", "Fox Den EUW 1 <noreply@mail.example.com>")]
    [InlineData("foxfire.gg", "foxfire.gg <noreply@mail.example.com>")]
    [InlineData("Bob's Füchse", "Bob's Füchse <noreply@mail.example.com>")]
    public void The_name_goes_unquoted_without_what_would_need_quotes(string name, string expected) =>
        Assert.Equal(expected, ActiveEmailProvider.FromLine(name, Address));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\"<>,;:@\"")]
    public void With_nothing_left_of_the_name_it_is_the_bare_address(string name) =>
        Assert.Equal(Address, ActiveEmailProvider.FromLine(name, Address));
}
