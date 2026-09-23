import type { ComponentType, ReactNode } from 'react'
import type { Account, PlayerSearchResult } from '@foxfire/core'
import { useAssetManifest } from '../context/assetManifest'
import { profileIconUrl } from '../lib/assets'
import { tierCrest, tierLabel } from '../lib/rank'
import { Asset } from '../components/Asset'
import { EmptyState } from '../components/EmptyState'
import { MatchListSkeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'

/**
 * Whatever this app navigates with, wrapped around a row.
 *
 * The package has no router and should not gain one — a link is the one thing
 * on this page that differs between a browser with real URLs and a packaged
 * renderer on a hash history. The screen supplies it, the same way a player
 * route is handed its layout.
 */
export type PlayerLink = ComponentType<{
  account: Account
  className?: string
  children: ReactNode
}>

/** Solo-queue standing, or nothing at all for somebody unplaced. */
function RankChip({ entry }: { entry: PlayerSearchResult['soloEntry'] }): JSX.Element | null {
  if (!entry || entry.tier === null) return null

  const crest = tierCrest(entry.tier)

  return (
    <span className="flex shrink-0 items-center gap-1.5 text-2xs text-text-dim">
      {crest && <img src={crest} alt="" className="h-5 w-5" />}
      <span className="whitespace-nowrap">
        {tierLabel(entry.tier, entry.rank)}
        {entry.leaguePoints !== null && <span className="text-text-mute"> · {entry.leaguePoints} LP</span>}
      </span>
    </span>
  )
}

function PlayerRow({
  player,
  link: Link,
  isHome,
  onSetHome
}: {
  player: PlayerSearchResult
  link: PlayerLink
  isHome: boolean
  onSetHome: (account: Account) => void
}): JSX.Element {
  const assets = useAssetManifest()
  const { account } = player

  return (
    <li className="flex items-center gap-3 px-4 py-2.5 max-md:px-3">
      <Link account={account} className="flex min-w-0 flex-1 items-center gap-3">
        <Asset
          src={assets ? profileIconUrl(assets, account.profileIconId) : null}
          className="h-10 w-10 shrink-0 border border-hairline"
          rounded="rounded-md"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base text-text">
            {account.gameName}
            <span className="text-text-mute">#{account.tagLine}</span>
          </p>
          <p className="truncate text-2xs text-text-mute">
            {account.ownerUsername ? `Claimed by ${account.ownerUsername}` : 'Not claimed yet'}
            {account.summonerLevel !== null && ` · Level ${account.summonerLevel}`}
          </p>
        </div>
        <RankChip entry={player.soloEntry} />
      </Link>

      <button
        onClick={() => onSetHome(account)}
        disabled={isHome}
        title={isHome ? 'This browser opens on this account' : 'Open on this account in this browser'}
        className="shrink-0 rounded-md p-1.5 text-text-mute transition hover:text-accent disabled:text-accent"
      >
        <Icon.Star width={15} height={15} fill={isHome ? 'currentColor' : 'none'} />
      </button>
    </li>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <section className="overflow-hidden rounded-lg border border-hairline bg-surface/40">
      <p className="border-b border-hairline px-4 py-2 text-2xs font-medium uppercase tracking-widest text-text-mute">
        {label}
      </p>
      {children}
    </section>
  )
}

/**
 * Everybody this server keeps history for, and the box for finding one of them.
 *
 * Search used to be a live Riot lookup of any Riot ID in the world, on a screen
 * of its own, answering with games that could carry no LP because nothing about
 * that player was stored. This is the same idea pointed at the data the server
 * actually has: find somebody, open their dashboard, see what every game was
 * worth to them.
 *
 * Yours and everybody else are separated only when nothing has been typed. A
 * filtered list is already an answer to a question, and splitting four results
 * across two headed sections says less than listing them does.
 *
 * The home account comes from the caller rather than off these rows,
 * deliberately. Which account this machine opens on is a property of the whole
 * list, so reading it from a filtered one would move the star about as somebody
 * typed.
 */
export function PlayersPage({
  heading = 'Players',
  intro,
  query,
  onQueryChange,
  players,
  loading,
  homeAccountId,
  onSetHome,
  link
}: {
  /** What the page calls itself. The desktop reaches it under "Search". */
  heading?: string
  intro: string
  query: string
  onQueryChange: (query: string) => void
  players: PlayerSearchResult[]
  loading: boolean
  /** The account this machine opens on, from the full list rather than these rows. */
  homeAccountId: string | null
  onSetHome: (account: Account) => void
  link: PlayerLink
}): JSX.Element {
  const typed = query.trim()
  const mine = players.filter((p) => p.account.isMine !== false)
  const others = players.filter((p) => p.account.isMine === false)

  const rows = (list: PlayerSearchResult[]): JSX.Element => (
    <ul className="divide-y divide-hairline/60">
      {list.map((player) => (
        <PlayerRow
          key={player.account.id}
          player={player}
          link={link}
          isHome={player.account.id === homeAccountId}
          onSetHome={onSetHome}
        />
      ))}
    </ul>
  )

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 max-md:p-2">
      <div>
        <h1 className="font-display text-xl text-text">{heading}</h1>
        <p className="mt-0.5 text-sm text-text-mute">{intro}</p>
      </div>

      <div className="relative">
        <Icon.Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-mute" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Find a player by name or Riot ID"
          spellCheck={false}
          aria-label="Find a player"
          className="w-full rounded-md border border-hairline bg-surface py-2 pl-9 pr-3 text-base text-text outline-none transition placeholder:text-text-mute focus:border-accent-dim"
        />
      </div>

      {loading ? (
        <MatchListSkeleton rows={4} />
      ) : typed.length > 0 ? (
        players.length === 0 ? (
          <EmptyState
            icon={<Icon.Search />}
            title="Nobody here by that name"
            description={`This server keeps history for the accounts it tracks, and none of them match ${typed}. An administrator can start tracking somebody new.`}
          />
        ) : (
          <Section label={`${players.length} ${players.length === 1 ? 'player' : 'players'}`}>
            {rows(players)}
          </Section>
        )
      ) : (
        <>
          <Section label="Yours">
            {mine.length === 0 ? (
              <EmptyState
                icon={<Icon.Plus />}
                title="No League account of yours yet"
                description="Claim yours from Foxfire desktop, with the League client open and signed in — the client is what vouches that the account is yours. It shows up here as soon as it is claimed."
              />
            ) : (
              rows(mine)
            )}
          </Section>

          {others.length > 0 && <Section label="Everybody else">{rows(others)}</Section>}
        </>
      )}
    </div>
  )
}
