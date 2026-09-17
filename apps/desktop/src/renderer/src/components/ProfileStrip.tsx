import type { Account, LeagueEntry } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { profileIconUrl } from '../lib/assets'
import { queueLabel, rankRecord, tierColor, tierCrest, tierLabel } from '../lib/rank'
import { Asset } from './Asset'
import { SyncProgressBar } from './SyncProgressBar'
import * as Icon from './icons'

function RankChip({ entry }: { entry: LeagueEntry | undefined }): JSX.Element | null {
  if (!entry?.tier) return null
  const { winRate } = rankRecord(entry)

  return (
    <div className="flex items-center gap-2 rounded-md border border-hairline bg-canvas px-2.5 py-1.5">
      <Asset src={tierCrest(entry.tier)} className="h-8 w-8" rounded="rounded-none" />
      <div>
        <p className="text-2xs uppercase tracking-widest text-text-mute">
          {queueLabel(entry.queueType)}
        </p>
        <p className="text-sm leading-tight" style={{ color: tierColor(entry.tier) }}>
          {tierLabel(entry.tier, entry.rank)}
          <span className="ml-1.5 tabular-nums text-text-dim">{entry.leaguePoints} LP</span>
          {winRate !== null && (
            <span className="ml-1.5 tabular-nums text-text-mute">{winRate}%</span>
          )}
        </p>
      </div>
    </div>
  )
}

/**
 * The horizontal form of the identity rail, used below 1280px.
 *
 * The two-column layout needs roughly 1272px before the match row starts
 * clipping its item slots, and the window can be resized down to 1024. Rather
 * than degrade the row, the rail folds into this strip and gives the full
 * width back to the match list.
 */
export function ProfileStrip({
  account,
  leagueEntries,
  onRefresh,
  refreshing
}: {
  account: Account
  leagueEntries: LeagueEntry[]
  onRefresh: () => void
  refreshing: boolean
}): JSX.Element {
  const assets = useAssets()

  return (
    <section className="rounded-lg border border-hairline bg-surface p-3">
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Asset
            src={assets ? profileIconUrl(assets, account.profileIconId) : null}
            className="h-12 w-12 border border-accent-dim"
            rounded="rounded-md"
          />
          {account.summonerLevel !== null && (
            <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full border border-accent-dim bg-canvas px-1.5 text-[9px] font-medium tabular-nums text-accent">
              {account.summonerLevel}
            </span>
          )}
        </div>

        <div className="min-w-0">
          <h1 className="truncate font-display text-lg leading-tight text-text">
            {account.gameName}
          </h1>
          <p className="text-2xs text-text-mute">
            #{account.tagLine}
            {account.tagLine.toUpperCase() !== account.platform.toUpperCase() &&
              ` · ${account.platform.toUpperCase()}`}
          </p>
        </div>

        <div className="ml-2 flex min-w-0 flex-wrap gap-2">
          <RankChip entry={leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5')} />
          <RankChip entry={leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR')} />
        </div>

        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
        >
          <Icon.Sync className={refreshing ? 'animate-spin' : undefined} />
          {refreshing ? 'Syncing…' : 'Sync now'}
        </button>
      </div>

      <SyncProgressBar accountId={account.id} />
    </section>
  )
}
