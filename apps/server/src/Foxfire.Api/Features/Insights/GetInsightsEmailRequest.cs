using Foxfire.Api.Common;
using Foxfire.Api.Email;
using Foxfire.Api.Telemetry;
using Foxfire.Core;
using static Foxfire.Api.Features.Insights.InsightsShapes;

namespace Foxfire.Api.Features.Insights;

/// <param name="Sent">Handed to the provider.</param>
/// <param name="Held">Moved into waiting on a limit or the provider.</param>
/// <param name="Retried">Attempts that will be made again — an outage, a rate limit.</param>
/// <param name="Failed">Given up on, or refused outright.</param>
/// <param name="Dropped">Never sent, because their link lapsed or was withdrawn first.</param>
public sealed record InsightsEmailTotals(
    long Sent,
    long Held,
    long Retried,
    long Failed,
    long Dropped,
    long Delivered,
    long Bounced,
    long Complained);

/// <param name="Configured">Whether this server sends mail at all.</param>
/// <param name="DailyLimit">Zero is no cap.</param>
public sealed record InsightsEmailNow(
    bool Configured,
    int Queued,
    int Held,
    int DailyUsed,
    int DailyLimit,
    int MonthlyUsed,
    int MonthlyLimit);

/// <param name="Sends">Attempts per point, by outcome: sent, held, retry, failed, dropped.</param>
/// <param name="Events">What the provider said per point: delivered, bounced, complained.</param>
/// <param name="Queue">The most waiting in each point, queued and held.</param>
/// <param name="Quota">The day's and month's count, as the dispatcher last saw it.</param>
public sealed record InsightsEmailResponse(
    InsightsFrameResponse Frame,
    InsightsEmailTotals Totals,
    InsightsEmailNow Now,
    IReadOnlyList<InsightSeriesResponse> Sends,
    IReadOnlyList<InsightSeriesResponse> Events,
    IReadOnlyList<InsightSeriesResponse> Queue,
    IReadOnlyList<InsightSeriesResponse> Quota);

/// <summary>
/// How the server's mail has been going. Head admins only, like the Email page
/// it sits beside — see AdminInsightsEndpoints.
/// </summary>
public sealed record GetInsightsEmailRequest(string? Window) : IDomainRequest<InsightsEmailResponse>;

internal sealed class GetInsightsEmailRequestHandler(
    InsightsReader reader,
    TelemetryCollector collector,
    ActiveEmailProvider active,
    EmailState state)
    : IDomainRequestHandler<GetInsightsEmailRequest, InsightsEmailResponse>
{
    private static readonly string[] Metrics =
    [
        InsightMetrics.EmailSends,
        InsightMetrics.EmailEvents,
        InsightMetrics.EmailQueueDepth,
        InsightMetrics.EmailQuotaUsed
    ];

    private static readonly string[] Outcomes = ["sent", "held", "retry", "failed", "dropped"];
    private static readonly string[] Events = ["delivered", "bounced", "complained"];

    public async Task<Response<InsightsEmailResponse>> Handle(
        GetInsightsEmailRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (InsightWindows.Parse(request.Window) is not { } window)
        {
            return InvalidWindow<InsightsEmailResponse>(request.Window);
        }

        var frame = await reader.ReadAsync(window, Metrics, cancellationToken);

        long Sends(params string[] outcomes) =>
            (long)frame.Total(InsightMetrics.EmailSends, d => outcomes.Contains(At(d, 1))).Sum;

        long Heard(string @event) =>
            (long)frame.Total(InsightMetrics.EmailEvents, d => At(d, 1) == @event).Sum;

        var totals = new InsightsEmailTotals(
            Sent: Sends("sent"),
            Held: Sends("held"),
            Retried: Sends("retry"),
            Failed: Sends("failed", "refused"),
            Dropped: Sends("dropped"),
            Delivered: Heard("delivered"),
            Bounced: Heard("bounced"),
            Complained: Heard("complained"));

        var snapshot = state.Current;
        var limits = active.Provider?.Limits;

        var now = new InsightsEmailNow(
            active.IsEnabled,
            snapshot?.Queued ?? 0,
            snapshot?.Held ?? 0,
            snapshot?.DailyUsed ?? 0,
            limits?.DailyLimit ?? 0,
            snapshot?.MonthlyUsed ?? 0,
            limits?.MonthlyLimit ?? 0);

        return new InsightsEmailResponse(
            Frame(frame, collector.StartedAt),
            totals,
            now,
            [
                .. Outcomes.Select(o => Series(o, frame.Values(
                    InsightMetrics.EmailSends,
                    Sum,
                    d => o == "failed" ? At(d, 1) is "failed" or "refused" : At(d, 1) == o)))
            ],
            [.. Events.Select(e => Series(e, frame.Values(InsightMetrics.EmailEvents, Sum, d => At(d, 1) == e)))],
            [
                Series("queued", frame.Values(InsightMetrics.EmailQueueDepth, Max, d => At(d, 0) == "queued", empty: null)),
                Series("held", frame.Values(InsightMetrics.EmailQueueDepth, Max, d => At(d, 0) == "held", empty: null))
            ],
            [
                Series("daily", frame.Values(InsightMetrics.EmailQuotaUsed, Max, d => At(d, 0) == "daily", empty: null)),
                Series("monthly", frame.Values(InsightMetrics.EmailQuotaUsed, Max, d => At(d, 0) == "monthly", empty: null))
            ]);
    }
}
