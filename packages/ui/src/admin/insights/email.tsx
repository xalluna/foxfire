import type { InsightsEmail } from '@foxfire/core'
import { COLOUR, InsightChart, Tile, Tiles, count, percent } from './parts'

const perPoint = (value: number): string => (value >= 100 ? count(value) : String(Math.round(value * 10) / 10))

/**
 * How the server's mail has been going: what went, what waited on a limit,
 * and what the provider said came of it. The addresses themselves are on the
 * Email page — this is the shape of it over time.
 */
export function EmailTab({ data }: { data: InsightsEmail }): JSX.Element {
  const { frame, totals, now } = data

  if (!now.configured) {
    return (
      <p className="rounded-lg border border-hairline bg-surface px-4 py-3 text-xs text-text-dim">
        This server has no email provider, so it sends nothing and there is nothing to chart. Set
        Email__Provider to start — see the Email page.
      </p>
    )
  }

  const reported = totals.delivered + totals.bounced + totals.complained

  return (
    <div className="space-y-6">
      <Tiles>
        <Tile
          label="Sent"
          value={count(totals.sent)}
          detail={totals.retried > 0 ? `${count(totals.retried)} tried again` : 'nothing retried'}
        />
        <Tile
          label="Delivered"
          value={count(totals.delivered)}
          detail={reported > 0 ? `${percent(totals.delivered, reported)} of what was heard back` : 'no word yet'}
          tone={totals.delivered > 0 ? 'good' : 'normal'}
        />
        <Tile
          label="Bounced"
          value={count(totals.bounced)}
          detail={totals.complained > 0 ? `${count(totals.complained)} marked as spam` : 'none marked as spam'}
          tone={totals.complained > 0 ? 'bad' : totals.bounced > 0 ? 'warn' : 'good'}
        />
        <Tile
          label="Held"
          value={count(totals.held)}
          detail={`${count(totals.failed)} failed · ${count(totals.dropped)} dropped`}
          tone={totals.held > 0 || totals.failed > 0 ? 'warn' : 'normal'}
        />
      </Tiles>

      <p className="text-2xs text-text-dim">
        Now: {now.dailyUsed}
        {now.dailyLimit > 0 ? ` of ${now.dailyLimit}` : ''} today · {count(now.monthlyUsed)}
        {now.monthlyLimit > 0 ? ` of ${count(now.monthlyLimit)}` : ''} this month · {now.queued} waiting ·{' '}
        {now.held} held
      </p>

      <InsightChart
        title="Sends"
        hint="what each attempt came to"
        frame={frame}
        source={data.sends}
        format={perPoint}
        lines={[
          { key: 'sent', label: 'Sent', colour: COLOUR.teal, step: true, fill: true },
          { key: 'held', label: 'Held', colour: COLOUR.amber, step: true },
          { key: 'retry', label: 'Tried again', colour: COLOUR.gold, step: true },
          { key: 'failed', label: 'Failed', colour: COLOUR.red, step: true },
          { key: 'dropped', label: 'Dropped', colour: COLOUR.dim, step: true }
        ]}
      />
      <InsightChart
        title="What came of it"
        hint="as the provider reported back"
        frame={frame}
        source={data.events}
        format={perPoint}
        lines={[
          { key: 'delivered', label: 'Delivered', colour: COLOUR.teal, step: true },
          { key: 'bounced', label: 'Bounced', colour: COLOUR.amber, step: true },
          { key: 'complained', label: 'Spam', colour: COLOUR.red, step: true }
        ]}
      />
      <InsightChart
        title="Quota"
        hint="used today and this month"
        frame={frame}
        source={data.quota}
        format={(v) => count(v)}
        lines={[
          { key: 'daily', label: 'Today', colour: COLOUR.accent },
          { key: 'monthly', label: 'This month', colour: COLOUR.gold }
        ]}
      />
      <InsightChart
        title="Waiting"
        hint="the most in the queue at once"
        frame={frame}
        source={data.queue}
        format={perPoint}
        lines={[
          { key: 'queued', label: 'Queued', colour: COLOUR.accent, step: true },
          { key: 'held', label: 'Held', colour: COLOUR.amber, step: true }
        ]}
      />
    </div>
  )
}
