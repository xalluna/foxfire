import type { LeagueEntry } from '@shared/types'
import { queueLabel, rankRecord, tierColor, tierCrest, tierLabel } from '../lib/rank'
import { Asset } from './Asset'

/**
 * One ranked queue. Renders in both the ranked and unranked case — an empty
 * queue still gets a card so the rail keeps a stable shape rather than
 * collapsing when someone hasn't played flex.
 */
export function RankCard({ entry }: { entry: LeagueEntry }): JSX.Element {
  const { games, winRate } = rankRecord(entry)
  const crest = tierCrest(entry.tier)
  const ranked = entry.tier !== null

  return (
    <div className="rounded-lg border border-hairline bg-surface p-3">
      <p className="text-2xs font-medium uppercase tracking-widest text-text-mute">
        {queueLabel(entry.queueType)}
      </p>

      <div className="mt-2 flex items-center gap-3">
        {crest ? (
          <Asset src={crest} className="h-12 w-12" rounded="rounded-none" />
        ) : (
          // A dashed hexagon-ish placeholder keeps unranked visually parallel
          // to a crest without pretending to be one.
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-hairline text-2xs text-text-mute">
            —
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p
            className="truncate font-display text-lg leading-tight"
            style={{ color: tierColor(entry.tier) }}
          >
            {tierLabel(entry.tier, entry.rank)}
          </p>
          {ranked && (
            <p className="text-sm tabular-nums text-text-dim">{entry.leaguePoints} LP</p>
          )}
        </div>
      </div>

      {ranked && games > 0 && (
        <div className="mt-2.5 border-t border-hairline pt-2">
          <div className="flex items-baseline justify-between text-2xs tabular-nums">
            <span className="text-text-dim">
              {entry.wins}W {entry.losses}L
            </span>
            <span className={winRate !== null && winRate >= 50 ? 'text-teal' : 'text-text-dim'}>
              {winRate}%
            </span>
          </div>
          <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-red/40">
            <div className="h-full bg-teal" style={{ width: `${winRate ?? 0}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
