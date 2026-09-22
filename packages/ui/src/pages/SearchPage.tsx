import { useState } from 'react'
import type { AdHocSummonerResult } from '@foxfire/core'
import { useAssetManifest } from '../context/assetManifest'
import { profileIconUrl } from '../lib/assets'
import { emptyEntry } from '../lib/rank'
import { Asset } from '../components/Asset'
import { RankCard } from '../components/RankCard'
import { MatchListRow } from '../components/MatchListRow'
import { RecentSummary } from '../components/RecentSummary'
import { EmptyState } from '../components/EmptyState'
import { MatchListSkeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'

/**
 * One-off lookup for summoners the user doesn't track.
 *
 * Reuses the Dashboard's match row and summary rather than a simplified copy —
 * searchService returns the same enriched MatchSummary shape the local database
 * does, so there is no reason for this screen to show less.
 */
export function SearchPage({
  example,
  onSearch,
  result,
  pending,
  error
}: {
  /** A Riot ID for the placeholder, which the failure message names too. */
  example: string
  onSearch: (raw: string) => void
  result: AdHocSummonerResult | undefined
  pending: boolean
  /** Why the last lookup failed, or null. */
  error: string | null
}): JSX.Element {
  const assets = useAssetManifest()
  const [value, setValue] = useState('')
  const search = { isPending: pending, isError: error !== null }
  const solo =
    result?.leagueEntries.find((e) => e.queueType === 'RANKED_SOLO_5x5') ??
    emptyEntry('RANKED_SOLO_5x5')
  const flex =
    result?.leagueEntries.find((e) => e.queueType === 'RANKED_FLEX_SR') ??
    emptyEntry('RANKED_FLEX_SR')

  return (
    /*
      Capped at 1280 rather than a narrower reading column, because the aside
      below is gated on `xl:` — a viewport query — while this cap measures the
      container. The two have to name the same width, or crossing 1280px carves
      a 320px rail out of a box that never grows to hold it and the row loses
      its item slots to the list's overflow-hidden. ProfileStrip puts the figure
      at roughly 1272px; this is the nearest step above it, and the cap LiveGame
      already uses.
    */
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4">
      <div>
        <h1 className="font-display text-xl text-text">Look up a summoner</h1>
        <p className="mt-0.5 text-sm text-text-mute">
          Fetched live and not saved. Add an account instead to keep full history.
        </p>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          onSearch(value)
        }}
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={example}
          spellCheck={false}
          className="flex-1 rounded-md border border-hairline bg-surface px-3 py-2 text-base text-text outline-none transition placeholder:text-text-mute focus:border-accent-dim"
        />
        <button
          type="submit"
          disabled={!value.trim() || search.isPending}
          className="flex items-center gap-1.5 rounded-md border border-accent-dim bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
        >
          <Icon.Search />
          {search.isPending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {search.isError && (
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="Lookup failed"
          description={error ?? 'Unknown error'}
        />
      )}

      {search.isPending && <MatchListSkeleton rows={5} />}

      {!search.isPending && !result && !search.isError && (
        <EmptyState
          icon={<Icon.Search />}
          title="Search any Riot ID"
          description="Look up rank and recent games for a player you don't track — a duo partner, or someone from your last lobby."
        />
      )}

      {result && (
        <div className="flex gap-4">
          {/* Hidden below 1280px for the same reason as the Dashboard rail. */}
          <aside className="hidden w-stats shrink-0 space-y-3 self-start xl:sticky xl:top-4 xl:block">
            <section className="rounded-lg border border-hairline bg-surface p-4">
              <div className="flex flex-col items-center text-center">
                <div className="relative">
                  <Asset
                    src={assets ? profileIconUrl(assets, result.profile.profileIconId) : null}
                    className="h-20 w-20 border-2 border-accent-dim"
                    rounded="rounded-lg"
                  />
                  <span className="absolute -bottom-2.5 left-1/2 -translate-x-1/2 rounded-full border border-accent-dim bg-canvas px-2 py-0.5 text-2xs font-medium tabular-nums text-accent">
                    {result.profile.summonerLevel}
                  </span>
                </div>
                <h2 className="mt-4 max-w-full truncate font-display text-xl text-text">
                  {result.profile.gameName}
                </h2>
                <p className="text-sm text-text-mute">#{result.profile.tagLine}</p>
              </div>
            </section>

            <RankCard entry={solo} />
            <RankCard entry={flex} />
          </aside>

          {/* flex+gap, not space-y — see the note in Dashboard.tsx. */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3 xl:hidden">
              <Asset
                src={assets ? profileIconUrl(assets, result.profile.profileIconId) : null}
                className="h-12 w-12 border border-accent-dim"
                rounded="rounded-md"
              />
              <div className="min-w-0">
                <h2 className="truncate font-display text-lg leading-tight text-text">
                  {result.profile.gameName}
                </h2>
                <p className="text-2xs text-text-mute">
                  #{result.profile.tagLine} · Level {result.profile.summonerLevel}
                </p>
              </div>
              <div className="ml-auto flex gap-2">
                <div className="w-52">
                  <RankCard entry={solo} />
                </div>
              </div>
            </div>

            <RecentSummary matches={result.recentMatches} />

            <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
              <p className="border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
                Last {result.recentMatches.length} games
              </p>
              <ul className="divide-y divide-hairline/60">
                {result.recentMatches.map((match) => (
                  <li key={match.matchId}>
                    {/* Not expandable: ad-hoc lookups aren't stored, so there is no detail to fetch. */}
                    <MatchListRow
                      match={match}
                      expanded={false}
                      onToggle={() => {}}
                      expandable={false}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
