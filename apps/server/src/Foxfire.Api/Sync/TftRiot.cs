using Foxfire.Core;
using Foxfire.Riot;

namespace Foxfire.Api.Sync;

/// <summary>
/// The client every TFT call goes through, and which key it holds.
///
/// Registered beside the main <see cref="RiotClient"/> rather than replacing
/// it. With a TFT key of its own (<c>Riot__Tft__ApiKey</c>) it is a separate
/// client on a separate queue with that key's limits; without one it is the
/// main key through the main queue, built so that a 403 from a TFT endpoint is
/// read as the key having no TFT rather than the key being refused — which
/// would latch the queue and stop League too.
/// </summary>
/// <param name="HasOwnKey">
/// Whether TFT has a key of its own. Riot encrypts a puuid per key, so this is
/// also whether an account's TFT puuid differs from its League one.
/// </param>
public sealed record TftRiot(RiotClient Client, bool HasOwnKey)
{
    /// <summary>The key TFT's puuids are encrypted under.</summary>
    public RiotKeyScope Scope => HasOwnKey ? RiotKeyScope.Tft : RiotKeyScope.Main;
}
