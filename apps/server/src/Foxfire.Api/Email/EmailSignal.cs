namespace Foxfire.Api.Email;

/// <summary>
/// A tap on the dispatcher's shoulder: something was queued, look now rather
/// than at the next tick.
///
/// Taps do not queue up. Ten invites made at once are one wake-up, and the
/// dispatcher sends everything that is due when it wakes.
/// </summary>
public sealed class EmailSignal : IDisposable
{
    private readonly SemaphoreSlim _wake = new(0, 1);

    public void Poke()
    {
        try
        {
            if (_wake.CurrentCount == 0) _wake.Release();
        }
        catch (SemaphoreFullException)
        {
            // Somebody else tapped first. One wake-up is all it takes.
        }
    }

    /// <summary>Waits for a tap or the timeout, whichever comes first. True when it was a tap.</summary>
    public Task<bool> WaitAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
        _wake.WaitAsync(timeout, cancellationToken);

    public void Dispose() => _wake.Dispose();
}
