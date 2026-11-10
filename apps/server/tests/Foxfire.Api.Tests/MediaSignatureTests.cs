using System.Text;
using Foxfire.Api.Configuration;
using Foxfire.Api.Features.Recordings;
using Foxfire.Api.Media;

namespace Foxfire.Api.Tests;

/// <summary>
/// The rules under recordings that need no server: Foxfire Media's webhook
/// signature, how its states fold into ours, and the settings that turn it on.
/// </summary>
public class MediaSignatureTests
{
    private const string Key = "media-test-key-not-real-0123456789abcdef";
    private static readonly byte[] Body = Encoding.UTF8.GetBytes("""{"type":"video.ready","data":{"videoId":"abc"}}""");
    private static readonly DateTimeOffset Now = new(2026, 11, 10, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void A_signature_made_with_the_key_checks_out()
    {
        Assert.True(MediaSignature.Verify(MediaSignature.Sign(Body, Key, Now), Body, Key, Now));
    }

    [Fact]
    public void The_signature_is_the_hmac_of_the_time_and_the_body_as_foxfire_media_documents_it()
    {
        // From Foxfire Media's README: HMAC-SHA256 of "<t>.<raw body>", keyed with the API key, as hex.
        var t = Now.ToUnixTimeSeconds();
        var expected = Convert.ToHexStringLower(System.Security.Cryptography.HMACSHA256.HashData(
            Encoding.UTF8.GetBytes(Key), Encoding.UTF8.GetBytes($"{t}.{Encoding.UTF8.GetString(Body)}")));

        Assert.True(MediaSignature.Verify($"t={t},v1={expected}", Body, Key, Now));
    }

    [Fact]
    public void Another_key_a_changed_body_or_a_stale_time_does_not()
    {
        var header = MediaSignature.Sign(Body, Key, Now);

        Assert.False(MediaSignature.Verify(header, Body, "another-key-entirely-000000000000", Now));
        Assert.False(MediaSignature.Verify(header, Encoding.UTF8.GetBytes("{}"), Key, Now));
        Assert.False(MediaSignature.Verify(header, Body, Key, Now.AddMinutes(6)));
        Assert.False(MediaSignature.Verify(null, Body, Key, Now));
        Assert.False(MediaSignature.Verify("t=abc,v1=00", Body, Key, Now));
    }

    [Fact]
    public void Any_one_of_two_signatures_is_enough_while_foxfire_media_rotates_its_key()
    {
        var good = MediaSignature.Sign(Body, Key, Now);
        var v1 = good[(good.IndexOf("v1=", StringComparison.Ordinal) + 3)..];

        Assert.True(MediaSignature.Verify($"t={Now.ToUnixTimeSeconds()},v1={new string('0', 64)},v1={v1}", Body, Key, Now));
    }

    [Theory]
    [InlineData("AwaitingUpload", RecordingStatuses.Uploading)]
    [InlineData("Uploading", RecordingStatuses.Uploading)]
    [InlineData("UploadFailed", RecordingStatuses.UploadFailed)]
    [InlineData("UploadExpired", RecordingStatuses.UploadFailed)]
    [InlineData("Queued", RecordingStatuses.Processing)]
    [InlineData("Processing", RecordingStatuses.Processing)]
    [InlineData("Ready", RecordingStatuses.Ready)]
    [InlineData("Failed", RecordingStatuses.Failed)]
    public void Foxfire_medias_states_fold_into_the_ones_a_client_acts_on(string media, string ours)
    {
        Assert.Equal(ours, RecordingStatuses.FromMedia(media));
    }

    [Fact]
    public void Ready_outranks_everything_and_failed_can_still_become_ready()
    {
        Assert.True(RecordingStatuses.Rank(RecordingStatuses.Ready) > RecordingStatuses.Rank(RecordingStatuses.Failed));
        Assert.True(RecordingStatuses.Rank(RecordingStatuses.Failed) > RecordingStatuses.Rank(RecordingStatuses.Processing));
        Assert.True(RecordingStatuses.Rank(RecordingStatuses.Processing) > RecordingStatuses.Rank(RecordingStatuses.Uploading));
        Assert.Equal(RecordingStatuses.Rank(RecordingStatuses.Uploading), RecordingStatuses.Rank(RecordingStatuses.UploadFailed));
    }

    [Fact]
    public void An_embed_is_asked_for_without_foxfire_medias_own_controls()
    {
        Assert.Equal("https://m/embed/x?controls=0", RecordingEmbeds.WithoutControls("https://m/embed/x"));
        Assert.Equal("https://m/embed/x?t=3&controls=0", RecordingEmbeds.WithoutControls("https://m/embed/x?t=3"));
    }

    [Fact]
    public void A_media_origin_is_its_scheme_host_and_port_only()
    {
        Assert.Equal("https://media.example.com", new MediaOptions { BaseUrl = "https://Media.Example.com/some/path" }.Origin);
        Assert.Equal("http://192.168.1.75:8080", new MediaOptions { BaseUrl = "http://192.168.1.75:8080/" }.Origin);
        Assert.Null(new MediaOptions { BaseUrl = "not a url" }.Origin);

        // A server reaching Foxfire Media on a Docker network frames it from its public address.
        Assert.Equal(
            "https://media.example.com",
            new MediaOptions { BaseUrl = "http://foxfire-media:8080", PublicUrl = "https://media.example.com/" }.Origin);
    }
}
