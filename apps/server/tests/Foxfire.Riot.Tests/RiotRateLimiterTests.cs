using Microsoft.Extensions.Time.Testing;

namespace Foxfire.Riot.Tests;

/// <summary>
/// The queue every Riot call shares.
///
/// Time is faked throughout. The desktop's equivalent tests really sleep, which
/// costs most of a second on one case alone; here the windows are advanced by
/// hand, so a two-minute sustained window is tested in microseconds and the
/// assertions are about the schedule rather than about whether a machine was
/// busy.
/// </summary>
public class RiotRateLimiterTests
{
    private static readonly DateTimeOffset T0 = new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

    private static readonly RiotRateLimits Tiny = new(
        BurstLimit: 2,
        BurstWindow: TimeSpan.FromSeconds(1),
        SustainedLimit: 5,
        SustainedWindow: TimeSpan.FromSeconds(10),
        RetryBackoff: TimeSpan.FromSeconds(1));

    /// <summary>
    /// Limits so generous the windows never bind.
    ///
    /// The ordering tests are about which job goes next, not about pacing. Under
    /// Tiny the pump would correctly stall on a burst window that a frozen fake
    /// clock never reopens, and the test would be measuring the clock.
    /// </summary>
    private static readonly RiotRateLimits Roomy = new(
        BurstLimit: 1_000,
        BurstWindow: TimeSpan.FromSeconds(1),
        SustainedLimit: 1_000,
        SustainedWindow: TimeSpan.FromSeconds(10),
        RetryBackoff: TimeSpan.FromSeconds(1));

    private static FakeTimeProvider Clock() => new(T0);

    /// <summary>Runs the pump forward until it settles, so assertions see a stable queue.</summary>
    private static async Task SettleAsync(FakeTimeProvider clock, TimeSpan? advance = null)
    {
        for (var i = 0; i < 20; i++)
        {
            await Task.Yield();
            if (advance is { } step) clock.Advance(step);
            await Task.Delay(1); // real time, so the pump's continuations actually run
        }
    }

    [Fact]
    public async Task A_scheduled_call_runs_and_returns_its_answer()
    {
        using var limiter = new RiotRateLimiter(Tiny, Clock());

        var answer = await limiter.ScheduleAsync(_ => Task.FromResult(42));

        Assert.Equal(42, answer);
    }

    [Fact]
    public async Task Interactive_work_goes_before_backfill_already_in_the_queue()
    {
        using var limiter = new RiotRateLimiter(Roomy, Clock());

        // Block the pump on the first job so the rest genuinely queue up behind
        // it rather than each completing before the next is scheduled.
        var started = new TaskCompletionSource();
        var gate = new TaskCompletionSource();
        List<string> order = [];

        var blocker = limiter.ScheduleAsync(async _ =>
        {
            started.SetResult();
            await gate.Task;
            order.Add("blocker");
            return 0;
        }, RiotRequestPriority.Interactive);

        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var backfill = limiter.ScheduleAsync(_ => { order.Add("backfill"); return Task.FromResult(0); }, RiotRequestPriority.Backfill);
        var postGame = limiter.ScheduleAsync(_ => { order.Add("postgame"); return Task.FromResult(0); }, RiotRequestPriority.PostGame);
        var search = limiter.ScheduleAsync(_ => { order.Add("search"); return Task.FromResult(0); }, RiotRequestPriority.Interactive);

        gate.SetResult();
        await Task.WhenAll(blocker, backfill, postGame, search).WaitAsync(TimeSpan.FromSeconds(5));

        // Queued last, ran first: that is the whole point of the classes.
        Assert.Equal(["blocker", "search", "postgame", "backfill"], order);
    }

    [Fact]
    public async Task Within_a_class_it_is_still_first_come_first_served()
    {
        using var limiter = new RiotRateLimiter(Roomy, Clock());

        var started = new TaskCompletionSource();
        var gate = new TaskCompletionSource();
        List<int> order = [];

        var blocker = limiter.ScheduleAsync(async _ => { started.SetResult(); await gate.Task; return 0; }, RiotRequestPriority.Backfill);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var rest = Enumerable.Range(1, 3)
            .Select(i => limiter.ScheduleAsync(_ => { order.Add(i); return Task.FromResult(i); }, RiotRequestPriority.Backfill))
            .ToArray();

        gate.SetResult();
        await Task.WhenAll([blocker, .. rest]).WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal([1, 2, 3], order);
    }

    [Fact]
    public async Task The_burst_window_holds_the_third_request_back()
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        var sent = 0;
        var jobs = Enumerable.Range(0, 3)
            .Select(_ => limiter.ScheduleAsync(_ => { Interlocked.Increment(ref sent); return Task.FromResult(0); }))
            .ToArray();

        await SettleAsync(clock);

        // BurstLimit is 2, so the third is still waiting on the window.
        Assert.Equal(2, Volatile.Read(ref sent));

        clock.Advance(TimeSpan.FromSeconds(1));
        await Task.WhenAll(jobs).WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(3, Volatile.Read(ref sent));
    }

    [Fact]
    public async Task A_burst_after_a_pause_still_respects_the_burst_limit()
    {
        // The case the desktop's limiter gets wrong. Fill the burst window, wait
        // long enough that old timestamps survive in the sustained window but the
        // burst window has rolled, then fill it again — the limiter must count
        // the recent dispatches, not the oldest surviving one.
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        await limiter.ScheduleAsync(_ => Task.FromResult(0)).WaitAsync(TimeSpan.FromSeconds(5));
        clock.Advance(TimeSpan.FromSeconds(2));

        var sent = 0;
        var jobs = Enumerable.Range(0, 3)
            .Select(_ => limiter.ScheduleAsync(_ => { Interlocked.Increment(ref sent); return Task.FromResult(0); }))
            .ToArray();

        await SettleAsync(clock);

        // Two through, one held. The first dispatch is still inside the ten-second
        // sustained window, so a limiter reading the oldest timestamp would compute
        // a negative wait, clamp it to zero, and let all three out.
        Assert.Equal(2, Volatile.Read(ref sent));

        clock.Advance(TimeSpan.FromSeconds(1));
        await Task.WhenAll(jobs).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(3, Volatile.Read(ref sent));
    }

    [Fact]
    public async Task A_429_is_retried_after_the_delay_riot_asked_for()
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        var attempts = 0;
        var job = limiter.ScheduleAsync(_ =>
        {
            if (Interlocked.Increment(ref attempts) == 1)
            {
                throw new RiotApiException("slow down", 429, TimeSpan.FromSeconds(30));
            }

            return Task.FromResult("ok");
        });

        await SettleAsync(clock);
        Assert.Equal(1, Volatile.Read(ref attempts));

        clock.Advance(TimeSpan.FromSeconds(31));
        Assert.Equal("ok", await job.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(2, Volatile.Read(ref attempts));
    }

    [Fact]
    public async Task A_throttled_call_keeps_its_place_at_the_front_of_its_class()
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        List<string> order = [];
        var first = 0;

        var throttled = limiter.ScheduleAsync(_ =>
        {
            if (Interlocked.Increment(ref first) == 1) throw new RiotApiException("429", 429, TimeSpan.FromSeconds(5));
            order.Add("throttled");
            return Task.FromResult(0);
        }, RiotRequestPriority.Backfill);

        var behind = limiter.ScheduleAsync(_ => { order.Add("behind"); return Task.FromResult(0); }, RiotRequestPriority.Backfill);

        await SettleAsync(clock, TimeSpan.FromSeconds(1));
        await Task.WhenAll(throttled, behind).WaitAsync(TimeSpan.FromSeconds(5));

        Assert.Equal(["throttled", "behind"], order);
    }

    [Fact]
    public async Task A_429_gives_up_after_three_attempts()
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        var attempts = 0;
        var job = limiter.ScheduleAsync<string>(_ =>
        {
            Interlocked.Increment(ref attempts);
            throw new RiotApiException("429", 429, TimeSpan.FromSeconds(1));
        });

        await SettleAsync(clock, TimeSpan.FromSeconds(2));

        var error = await Assert.ThrowsAsync<RiotApiException>(() => job.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(429, error.Status);
        Assert.Equal(4, Volatile.Read(ref attempts)); // the original, then three retries
    }

    [Fact]
    public async Task A_5xx_is_retried_with_a_growing_backoff()
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        var attempts = 0;
        var job = limiter.ScheduleAsync(_ =>
        {
            if (Interlocked.Increment(ref attempts) < 3) throw new RiotApiException("bad day", 503);
            return Task.FromResult("ok");
        });

        await SettleAsync(clock, TimeSpan.FromSeconds(1));

        Assert.Equal("ok", await job.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(3, Volatile.Read(ref attempts));
    }

    [Fact]
    public async Task A_404_is_not_retried()
    {
        using var limiter = new RiotRateLimiter(Tiny, Clock());

        var attempts = 0;
        var job = limiter.ScheduleAsync<string>(_ =>
        {
            Interlocked.Increment(ref attempts);
            throw new RiotApiException("no such summoner", 404);
        });

        await Assert.ThrowsAsync<RiotApiException>(() => job.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(1, Volatile.Read(ref attempts));
    }

    [Theory]
    [InlineData(401)]
    [InlineData(403)]
    public async Task A_rejected_key_fails_everything_queued_rather_than_leaving_it_hanging(int status)
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Tiny, clock);

        var gate = new TaskCompletionSource();
        var blocker = limiter.ScheduleAsync<string>(async _ =>
        {
            await gate.Task;
            throw new RiotApiException("expired", status);
        });

        var behind = Enumerable.Range(0, 3)
            .Select(_ => limiter.ScheduleAsync(_ => Task.FromResult("never")))
            .ToArray();

        gate.SetResult();

        await Assert.ThrowsAsync<RiotApiException>(() => blocker.WaitAsync(TimeSpan.FromSeconds(5)));
        foreach (var job in behind)
        {
            await Assert.ThrowsAsync<RiotApiException>(() => job.WaitAsync(TimeSpan.FromSeconds(5)));
        }

        Assert.True(limiter.KeyRejected);
        Assert.Equal(status, limiter.Rejection?.Status);
        Assert.Equal(0, limiter.QueueDepth);
    }

    [Fact]
    public async Task Work_scheduled_after_a_rejection_fails_immediately_rather_than_queueing()
    {
        using var limiter = new RiotRateLimiter(Tiny, Clock());

        await Assert.ThrowsAsync<RiotApiException>(
            () => limiter.ScheduleAsync<string>(_ => throw new RiotApiException("expired", 401)));

        var after = limiter.ScheduleAsync(_ => Task.FromResult("nope"));

        Assert.True(after.IsFaulted);
        Assert.Equal(0, limiter.QueueDepth);
    }

    [Fact]
    public async Task Resume_clears_the_latch_and_lets_work_flow_again()
    {
        using var limiter = new RiotRateLimiter(Tiny, Clock());

        await Assert.ThrowsAsync<RiotApiException>(
            () => limiter.ScheduleAsync<string>(_ => throw new RiotApiException("blip", 401)));
        Assert.True(limiter.KeyRejected);

        limiter.Resume();
        Assert.False(limiter.KeyRejected);

        Assert.Equal("ok", await limiter.ScheduleAsync(_ => Task.FromResult("ok")).WaitAsync(TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public async Task An_abandoned_caller_is_skipped_rather_than_dispatched()
    {
        var clock = Clock();
        using var limiter = new RiotRateLimiter(Roomy, clock);

        var started = new TaskCompletionSource();
        var gate = new TaskCompletionSource();
        var blocker = limiter.ScheduleAsync(async _ => { started.SetResult(); await gate.Task; return 0; });
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        using var abandon = new CancellationTokenSource();
        var ran = false;
        var doomed = limiter.ScheduleAsync(
            _ => { ran = true; return Task.FromResult(0); },
            RiotRequestPriority.Backfill,
            abandon.Token);

        await abandon.CancelAsync();
        gate.SetResult();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => doomed.WaitAsync(TimeSpan.FromSeconds(5)));
        await blocker.WaitAsync(TimeSpan.FromSeconds(5));
        await SettleAsync(clock);

        // The request must never have gone to Riot: the budget it would have
        // spent belongs to somebody who is still waiting.
        Assert.False(ran);
    }

    [Fact]
    public async Task Disposing_fails_everything_still_waiting()
    {
        var limiter = new RiotRateLimiter(Roomy, Clock());

        // The blocker has to be in flight before disposing, or it is simply one
        // more queued job and the test says nothing about work already sent.
        var started = new TaskCompletionSource();
        var gate = new TaskCompletionSource();
        var blocker = limiter.ScheduleAsync(async _ => { started.SetResult(); await gate.Task; return 0; });
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5));

        var waiting = limiter.ScheduleAsync(_ => Task.FromResult(0));

        limiter.Dispose();
        gate.SetResult();

        // Queued work is told the server is going away; work already sent to Riot
        // is allowed to land rather than being abandoned mid-flight.
        await Assert.ThrowsAsync<RiotApiException>(() => waiting.WaitAsync(TimeSpan.FromSeconds(5)));
        Assert.Equal(0, await blocker.WaitAsync(TimeSpan.FromSeconds(5)));
    }

    [Fact]
    public void Queue_depth_is_reported_per_class()
    {
        using var limiter = new RiotRateLimiter(Roomy, Clock());

        var gate = new TaskCompletionSource();
        _ = limiter.ScheduleAsync(async _ => { await gate.Task; return 0; }, RiotRequestPriority.Interactive);
        _ = limiter.ScheduleAsync(async _ => { await gate.Task; return 0; }, RiotRequestPriority.Backfill);
        _ = limiter.ScheduleAsync(async _ => { await gate.Task; return 0; }, RiotRequestPriority.Backfill);

        Assert.Equal(2, limiter.DepthOf(RiotRequestPriority.Backfill));
        Assert.Equal(0, limiter.DepthOf(RiotRequestPriority.PostGame));

        gate.SetResult();
    }
}
