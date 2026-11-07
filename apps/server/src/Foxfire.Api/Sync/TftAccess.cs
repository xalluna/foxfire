namespace Foxfire.Api.Sync;

/// <summary>Whether this server's Riot key reaches TFT, as far as it knows.</summary>
public enum TftAccessState
{
    Unknown,
    Granted,
    Denied
}

/// <summary>
/// Whether TFT can be fetched at all, and why not when it cannot.
///
/// Set by the probe at boot and by every TFT call's outcome since. A server
/// whose key is registered for League alone is a League server, and a healthy
/// one: a denial is a warning in the log and a line on the TFT pages, never
/// the key-rejected banner League's screens show, and never a reason to stop
/// League syncing.
///
/// A denial on a shared key is re-checked, at most every ten minutes, when
/// somebody asks for a TFT sync — the same 403 can mean an expired key, which
/// the next League call will say so about, and a key's products can change.
/// </summary>
public sealed class TftAccess(TimeProvider time, ILogger<TftAccess> logger)
{
    /// <summary>How long a denial stands before a TFT sync may ask Riot again.</summary>
    public static readonly TimeSpan ReprobeAfter = TimeSpan.FromMinutes(10);

    private readonly Lock _gate = new();
    private TftAccessState _state = TftAccessState.Unknown;
    private DateTimeOffset? _checkedAt;
    private string? _reason;

    public TftAccessState State
    {
        get
        {
            lock (_gate) return _state;
        }
    }

    /// <summary>Why TFT cannot be fetched, in words for a host. Null unless denied.</summary>
    public string? Reason
    {
        get
        {
            lock (_gate) return _state == TftAccessState.Denied ? _reason : null;
        }
    }

    /// <summary>The state as the wire spells it: unknown, granted, denied.</summary>
    public string Slug => State switch
    {
        TftAccessState.Granted => "granted",
        TftAccessState.Denied => "denied",
        _ => "unknown"
    };

    /// <summary>Whether a denial is old enough that a TFT sync should ask again rather than refuse.</summary>
    public bool MayReprobe
    {
        get
        {
            lock (_gate)
            {
                return _state != TftAccessState.Denied
                    || _checkedAt is not { } at
                    || time.GetUtcNow() - at >= ReprobeAfter;
            }
        }
    }

    /// <summary>A TFT call succeeded.</summary>
    public void Grant()
    {
        bool changed;
        lock (_gate)
        {
            changed = _state != TftAccessState.Granted;
            _state = TftAccessState.Granted;
            _checkedAt = time.GetUtcNow();
            _reason = null;
        }

        if (changed) logger.LogInformation("TFT is reachable with this server's Riot key");
    }

    /// <summary>A TFT call was refused for want of access.</summary>
    public void Deny(string reason)
    {
        bool changed;
        lock (_gate)
        {
            changed = _state != TftAccessState.Denied;
            _state = TftAccessState.Denied;
            _checkedAt = time.GetUtcNow();
            _reason = reason;
        }

        // Once per change of heart rather than once per refused call, or a
        // League-only server would fill its log with the same line every sync.
        if (changed) logger.LogWarning("TFT cannot be fetched: {Reason}", reason);
    }
}
