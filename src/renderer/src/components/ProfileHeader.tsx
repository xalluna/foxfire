import type { Account, LeagueEntry } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { profileIconUrl } from '../lib/assets'
import { emptyEntry } from '../lib/rank'
import { Asset } from './Asset'
import { RankCard } from './RankCard'
import { SyncProgressBar } from './SyncProgressBar'
import * as Icon from './icons'

/**
 * The identity rail: who this account is and where it stands right now.
 *
 * Offers no period picker on purpose. This is the "now" screen — the tier, LP
 * and record on the cards are all Riot's current reading, and pairing a live
 * rank with a record from some other window would describe nobody's account.
 * Past seasons are reachable on the Rank screen.
 *
 * Deliberately holds nothing about recent form — that belongs to the summary
 * block above the match list, so the two never show the same champion with two
 * different numbers.
 */
export function ProfileHeader({
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

  const solo =
    leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ?? emptyEntry('RANKED_SOLO_5x5')
  const flex =
    leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR') ?? emptyEntry('RANKED_FLEX_SR')


  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-hairline bg-surface p-4">
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            <Asset
              src={assets ? profileIconUrl(assets, account.profileIconId) : null}
              className="h-20 w-20 border-2 border-gold-dim"
              rounded="rounded-lg"
            />
            {account.summonerLevel !== null && (
              <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-gold-dim bg-canvas px-2 py-0.5 text-2xs font-medium tabular-nums text-gold">
                {account.summonerLevel}
              </span>
            )}
          </div>

          <h1 className="mt-4 max-w-full truncate font-display text-xl text-text">
            {account.gameName}
          </h1>
          {/*
            The tag usually already names the region ("Alluna#NA1" on na1), so
            appending the platform would just repeat it. Only shown when they
            genuinely differ — an EUW-tagged account playing on NA, say.
          */}
          <p className="text-sm text-text-mute">
            #{account.tagLine}
            {account.tagLine.toUpperCase() !== account.platform.toUpperCase() &&
              ` · ${account.platform.toUpperCase()}`}
          </p>

          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-gold-dim bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
          >
            <Icon.Sync className={refreshing ? 'animate-spin' : undefined} />
            {refreshing ? 'Syncing…' : 'Sync now'}
          </button>
        </div>

        <SyncProgressBar accountId={account.id} />
      </section>

      <RankCard entry={solo} />
      <RankCard entry={flex} />
    </div>
  )
}
