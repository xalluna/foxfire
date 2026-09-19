using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;

namespace Foxfire.Riot;

/// <summary>
/// The one queue every Riot call on this server goes through.
///
/// Riot's allowance is per key, and this server has exactly one key for
/// everybody on it. So there is one of these, and every caller — a search
/// somebody is watching, a post-game sync, an overnight backfill — waits in it
/// rather than racing to send requests independently and collecting 429s on
/// everyone's behalf.
///
/// Requests go out one at a time rather than concurrently. That reads like it
/// would hurt, and does not: Riot answers in well under a second, and the
/// sustained window is the real ceiling, so concurrency would only get the
/// budget spent sooner. Serial dispatch also makes the whole thing possible to
/// reason about, which matters more here than a throughput number nobody is
/// measuring.
///
/// Ported from the desktop's src/main/riot/rateLimiter.ts, and deliberately kept
/// recognisable against it: the same two sliding windows, the same three-attempt
/// ceiling, the same 429 requeue-at-head, the same latch on a rejected key. Two
/// things are new, and both come from this being a server rather than one
/// person's app. Work is now classed by priority, because one shared key makes
/// first-come-first-served unfair. And all of it is locked, because ASP.NET will
/// call this from many threads at once where Node's event loop would not.
/// </summary>
public sealed class RiotRateLimiter : IDisposable
{
    private const int MaxAttempts = 3;

    /// <summary>What a 429 with no Retry-After is assumed to mean.</summary>
    private static readonly TimeSpan BlindRetryAfter = TimeSpan.FromSeconds(2);

    private readonly Lock _gate = new();
    private readonly Queue<Job>[] _queues;
    private readonly Queue<DateTimeOffset> _dispatched = new();
    private readonly TimeProvider _time;
    private readonly ILogger _log;
    private readonly CancellationTokenSource _stopping = new();

    private RiotRateLimits _limits;
    private Task? _pump;
    private DateTimeOffset? _pausedUntil;
    private RiotApiException? _rejection;
    private bool _disposed;

    public RiotRateLimiter(
        RiotRateLimits? limits = null,
        TimeProvider? timeProvider = null,
        ILogger<RiotRateLimiter>? logger = null)
    {
        _limits = limits ?? RiotRateLimits.PersonalKey;
        _time = timeProvider ?? TimeProvider.System;
        _log = logger ?? NullLogger<RiotRateLimiter>.Instance;
        _queues = [.. Enum.GetValues<RiotRequestPriority>().Select(_ => new Queue<Job>())];
    }

    /// <summary>How many requests are waiting, across every class.</summary>
    public int QueueDepth
    {
        get { lock (_gate) { return _queues.Sum(q => q.Count); } }
    }

    /// <summary>How many are waiting in one class. What the admin page shows.</summary>
    public int DepthOf(RiotRequestPriority priority)
    {
        lock (_gate) { return _queues[(int)priority].Count; }
    }

    /// <summary>
    /// Whether Riot has rejected the key, as a latched value rather than an event.
    ///
    /// Latched for the same reason the desktop latches it: the moment a key is
    /// refused is almost never the moment somebody is looking. On a server it is
    /// worse — the key is configuration, read once at boot, so a key that was
    /// already expired is rejected on the very first request, hours before
    /// anybody opens the app to find out why nothing is syncing.
    ///
    /// Everything that reads stored data keeps working while this is true. A
    /// dead key costs new data, not the whole server.
    /// </summary>
    public bool KeyRejected
    {
        get { lock (_gate) { return _rejection is not null; } }
    }

    /// <summary>
    /// Raised once, the first time Riot refuses the key.
    ///
    /// A callback rather than a poll, because the moment it happens is usually
    /// the middle of the night — a personal key expires every twenty-four hours
    /// — and the people who need to know are asleep. Whoever is listening can
    /// have the news waiting for them.
    ///
    /// Once per latch: <see cref="Resume"/> arms it again. Fired outside the
    /// lock, because a handler that reached back into the queue under it would
    /// deadlock, and this one goes out over a socket.
    /// </summary>
    public event Action? KeyRejectedOnce;

    /// <summary>The rejection itself, for the message shown to an admin.</summary>
    public RiotApiException? Rejection
    {
        get { lock (_gate) { return _rejection; } }
    }

    /// <summary>
    /// Clears a latched rejection and lets work flow again.
    ///
    /// The desktop calls its equivalent when somebody pastes a new key. Here the
    /// key cannot change without a restart, so this exists for two narrower
    /// reasons: tests, and re-probing a key that may have been refused by a blip
    /// at Riot's end rather than by actually being expired. Without a re-probe a
    /// momentary 401 would brick the server until a human noticed and restarted
    /// it, which is a lot to hang on one bad response.
    /// </summary>
    public void Resume()
    {
        lock (_gate)
        {
            _rejection = null;
            _pausedUntil = null;
        }

        EnsurePumping();
    }

    /// <summary>Swaps the allowance. Takes effect on the next slot calculation.</summary>
    public void UpdateLimits(RiotRateLimits limits)
    {
        ArgumentNullException.ThrowIfNull(limits);
        lock (_gate) { _limits = limits; }
    }

    /// <summary>
    /// Queues one call and hands back its eventual answer.
    ///
    /// Fails immediately, rather than queueing, while the key is latched as
    /// rejected — there is no point joining a queue that cannot drain, and a
    /// caller wants an error it can show rather than a promise that never
    /// settles.
    /// </summary>
    public Task<T> ScheduleAsync<T>(
        Func<CancellationToken, Task<T>> request,
        RiotRequestPriority priority = RiotRequestPriority.Backfill,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ObjectDisposedException.ThrowIf(_disposed, this);

        var job = new Job<T>(request, priority);

        lock (_gate)
        {
            if (_rejection is not null) return Task.FromException<T>(_rejection);
            _queues[(int)priority].Enqueue(job);
        }

        // Cancelling abandons the caller's wait. The job stays in the queue and
        // is skipped when it reaches the front — removing it from the middle of
        // a Queue<T> would cost more than letting a dead entry fall out.
        if (cancellationToken.CanBeCanceled)
        {
            cancellationToken.Register(() => job.Source.TrySetCanceled(cancellationToken));
        }

        EnsurePumping();
        return job.Source.Task;
    }

    private void EnsurePumping()
    {
        lock (_gate)
        {
            if (_disposed) return;
            if (_pump is { IsCompleted: false }) return;
            if (_queues.All(q => q.Count == 0)) return;

            _pump = Task.Run(() => PumpAsync(_stopping.Token), CancellationToken.None);
        }
    }

    private async Task PumpAsync(CancellationToken stopping)
    {
        try
        {
            while (!stopping.IsCancellationRequested)
            {
                TimeSpan wait;
                lock (_gate)
                {
                    if (_rejection is not null) return;
                    if (!HasWork()) return;
                    wait = WaitForSlot();
                }

                if (wait > TimeSpan.Zero)
                {
                    await Task.Delay(wait, _time, stopping).ConfigureAwait(false);
                    continue;
                }

                Job? job;
                lock (_gate)
                {
                    job = Dequeue();
                    if (job is null) continue;
                    _dispatched.Enqueue(_time.GetUtcNow());
                }

                try
                {
                    await job.RunAsync(stopping).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    HandleFailure(job, ex);
                }
            }
        }
        catch (OperationCanceledException) when (stopping.IsCancellationRequested)
        {
            // Shutting down.
        }
        catch (Exception ex)
        {
            // The pump dying silently would strand every queued caller forever,
            // so anything unexpected takes the queue down with it, loudly.
            _log.LogError(ex, "Riot request pump failed");
            FailEverything(new RiotApiException("The Riot request queue stopped: " + ex.Message, 0));
        }
    }

    private bool HasWork() => _queues.Any(q => q.Count > 0);

    /// <summary>Highest class first, FIFO within it. Abandoned callers fall out here.</summary>
    private Job? Dequeue()
    {
        foreach (var queue in _queues)
        {
            while (queue.Count > 0)
            {
                var job = queue.Dequeue();
                if (!job.IsFinished) return job;
            }
        }

        return null;
    }

    /// <summary>How long until a request may go out. Caller holds the lock.</summary>
    private TimeSpan WaitForSlot()
    {
        var now = _time.GetUtcNow();

        if (_pausedUntil is { } until && now < until) return until - now;

        // Anything older than the long window can no longer constrain anything.
        while (_dispatched.Count > 0 && now - _dispatched.Peek() >= _limits.SustainedWindow)
        {
            _dispatched.Dequeue();
        }

        var burst = TimeSpan.Zero;
        if (_dispatched.Count >= _limits.BurstLimit)
        {
            // The oldest of the most recent BurstLimit dispatches is the one
            // whose expiry frees the next slot. Timestamps are in dispatch order,
            // so counting back from the end finds it without a scan.
            //
            // This is a deliberate correction, not a faithful port. The desktop
            // reads dispatchTimestamps[0] here — the oldest surviving timestamp
            // rather than the oldest inside the burst window — which after a
            // pause goes negative and clamps to zero, letting a burst of
            // BurstLimit+1 out. Nobody noticed because one person browsing does
            // not fill a burst window. A backfill on a shared key does, every
            // second, and the cost of being wrong is a 429 that pauses the whole
            // server queue rather than one request.
            var burstStart = _dispatched.Count - _limits.BurstLimit;
            var oldestInBurst = _dispatched.ElementAt(burstStart);
            var freesAt = oldestInBurst + _limits.BurstWindow;
            if (freesAt > now) burst = freesAt - now;
        }

        var sustained = TimeSpan.Zero;
        if (_dispatched.Count >= _limits.SustainedLimit)
        {
            var freesAt = _dispatched.Peek() + _limits.SustainedWindow;
            if (freesAt > now) sustained = freesAt - now;
        }

        return burst > sustained ? burst : sustained;
    }

    private void HandleFailure(Job job, Exception error)
    {
        if (error is not RiotApiException riot)
        {
            job.TrySetException(error);
            return;
        }

        // Too many requests. Wait out what Riot asked for and put this back at
        // the front of its own class, so a throttled call does not lose its
        // place to everything queued behind it.
        if (riot.Status == 429)
        {
            if (++job.Attempts <= MaxAttempts)
            {
                lock (_gate)
                {
                    _pausedUntil = _time.GetUtcNow() + (riot.RetryAfter ?? BlindRetryAfter);
                    Requeue(job);
                }

                _log.LogWarning(
                    "Riot returned 429; pausing {Delay} and retrying (attempt {Attempt} of {Max})",
                    riot.RetryAfter ?? BlindRetryAfter, job.Attempts, MaxAttempts);
                return;
            }

            job.TrySetException(riot);
            return;
        }

        // The key is no good. Nothing queued behind this can succeed either, so
        // everything fails now rather than one slow timeout at a time.
        if (riot.IsKeyRejection)
        {
            _log.LogError(
                "Riot rejected the API key ({Status}). Stored data still reads; nothing new will be fetched "
                + "until the key is replaced and the server restarted.",
                riot.Status);

            FailEverything(riot);
            job.TrySetException(riot);
            return;
        }

        // Riot having a bad minute. Back off linearly and try again.
        if (riot.Status >= 500 && ++job.Attempts <= MaxAttempts)
        {
            lock (_gate)
            {
                _pausedUntil = _time.GetUtcNow() + (_limits.RetryBackoff * job.Attempts);
                Requeue(job);
            }

            return;
        }

        job.TrySetException(riot);
    }

    /// <summary>Back to the front of its own class. Caller holds the lock.</summary>
    private void Requeue(Job job)
    {
        var queue = _queues[(int)job.Priority];
        var waiting = queue.ToArray();
        queue.Clear();
        queue.Enqueue(job);
        foreach (var other in waiting) queue.Enqueue(other);
    }

    private void FailEverything(RiotApiException error)
    {
        List<Job> stranded = [];
        bool newlyRejected;

        lock (_gate)
        {
            // Only a transition, and only a real key rejection. This method also
            // runs on shutdown and on a pump that died, and neither of those is
            // news anybody can act on by replacing a key.
            newlyRejected = _rejection is null && error.IsKeyRejection;

            _rejection = error;
            foreach (var queue in _queues)
            {
                stranded.AddRange(queue);
                queue.Clear();
            }
        }

        foreach (var job in stranded) job.TrySetException(error);

        if (newlyRejected)
        {
            try
            {
                KeyRejectedOnce?.Invoke();
            }
            catch (Exception ex)
            {
                // A listener that throws must not take the limiter with it. The
                // key is still rejected either way, and everything that reads
                // stored data still works.
                _log.LogError(ex, "A key-rejection listener threw");
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
        }

        _stopping.Cancel();
        FailEverything(new RiotApiException("The server is shutting down.", 0));
        _stopping.Dispose();
    }

    /// <summary>One queued call, with its answer type erased so they can share a queue.</summary>
    private abstract class Job(RiotRequestPriority priority)
    {
        public RiotRequestPriority Priority { get; } = priority;

        /// <summary>How many times this has been sent and come back retryable.</summary>
        public int Attempts { get; set; }

        /// <summary>True once the caller has an answer, or has stopped waiting for one.</summary>
        public abstract bool IsFinished { get; }

        public abstract bool TrySetException(Exception error);

        public abstract Task RunAsync(CancellationToken cancellationToken);
    }

    private sealed class Job<T>(Func<CancellationToken, Task<T>> request, RiotRequestPriority priority)
        : Job(priority)
    {
        public TaskCompletionSource<T> Source { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override bool IsFinished => Source.Task.IsCompleted;

        public override bool TrySetException(Exception error) => Source.TrySetException(error);

        public override async Task RunAsync(CancellationToken cancellationToken) =>
            Source.TrySetResult(await request(cancellationToken).ConfigureAwait(false));
    }
}
