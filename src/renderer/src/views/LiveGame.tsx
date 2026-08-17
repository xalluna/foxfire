import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account, LiveGameParticipant } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName, spellIconUrl } from '../lib/assets'
import { rankRecord, tierColor, tierCrest, tierLabel } from '../lib/rank'
import { Asset } from '../components/Asset'
import { EmptyState } from '../components/EmptyState'
import { Skeleton } from '../components/Skeleton'
import * as Icon from '../components/icons'

/** Each row resolves its own rank so the roster paints immediately instead of waiting on 10 calls. */
function RankBadge({ platform, puuid }: { platform: string; puuid: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['participantRank', puuid],
    queryFn: () => window.api.liveGame.participantRank(platform, puuid),
    staleTime: 5 * 60 * 1000
  })

  if (isLoading) return <Skeleton className="h-7 w-20" />

  if (!data?.tier) {
    return <span className="text-2xs text-text-mute">Unranked</span>
  }

  const { winRate } = rankRecord(data)

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <Asset src={tierCrest(data.tier)} className="h-7 w-7" rounded="rounded-none" />
      <div className="text-right">
        <p className="text-2xs leading-tight" style={{ color: tierColor(data.tier) }}>
          {tierLabel(data.tier, data.rank)}
        </p>
        {winRate !== null && (
          <p className="text-[10px] tabular-nums text-text-mute">{winRate}% WR</p>
        )}
      </div>
    </div>
  )
}

/**
 * Three states, in the order they are tested: a player Riot named, a player it
 * withheld, and a slot it told us nothing about at all.
 *
 * An anonymous row gives its name line over to the champion — that is the whole
 * of what is known — and shows no rank, because there is no puuid to ask with.
 * When even the champion is missing, the placeholders <Asset> draws hold the
 * slot so the team still reads five deep.
 */
function ParticipantRow({
  p,
  account,
  isTracked
}: {
  p: LiveGameParticipant
  account: Account
  isTracked: boolean
}): JSX.Element {
  const assets = useAssets()
  const champion = assets && p.championId !== null ? championName(assets, p.championId) : ''

  return (
    <div
      className={clsx(
        'flex items-center gap-2.5 rounded px-2 py-1.5',
        isTracked && 'bg-gold/10 ring-1 ring-inset ring-gold/25'
      )}
    >
      <Asset
        src={assets && p.championId !== null ? championIconUrl(assets, p.championId) : null}
        className="h-9 w-9"
        rounded="rounded-full"
      />

      <div className="flex shrink-0 flex-col gap-[3px]">
        <Asset
          src={assets && p.spell1Id !== null ? spellIconUrl(assets, p.spell1Id) : null}
          className="h-[17px] w-[17px]"
        />
        <Asset
          src={assets && p.spell2Id !== null ? spellIconUrl(assets, p.spell2Id) : null}
          className="h-[17px] w-[17px]"
        />
      </div>

      <div className="min-w-0 flex-1">
        {p.anonymous ? (
          <p className="truncate text-sm text-text-mute">{champion}</p>
        ) : (
          <>
            <p
              className={clsx(
                'truncate text-sm',
                isTracked ? 'font-medium text-text' : 'text-text-dim'
              )}
            >
              {p.gameName}
              {p.tagLine && <span className="text-text-mute">#{p.tagLine}</span>}
            </p>
            <p className="truncate text-2xs text-text-mute">{champion}</p>
          </>
        )}
      </div>

      {p.puuid !== null && <RankBadge platform={account.platform} puuid={p.puuid} />}
    </div>
  )
}

export function LiveGame({ account }: { account: Account }): JSX.Element {
  const { data, isFetching, refetch, isError, error, isFetched } = useQuery({
    queryKey: ['liveGame', account.id],
    queryFn: () => window.api.liveGame.check(account.id),
    enabled: false, // manual check only — no background polling
    retry: false
  })

  const blue = data?.participants.filter((p) => p.teamId === 100) ?? []
  const red = data?.participants.filter((p) => p.teamId === 200) ?? []

  const team = (participants: LiveGameParticipant[], label: string, won: boolean): JSX.Element => (
    <section className="rounded-lg border border-hairline bg-surface/40 p-2">
      <p
        className={clsx(
          'px-2 pb-1.5 text-2xs font-medium uppercase tracking-widest',
          won ? 'text-teal' : 'text-red'
        )}
      >
        {label}
      </p>
      <div className="space-y-0.5">
        {participants.map((p) => (
          <ParticipantRow
            key={p.slot}
            p={p}
            account={account}
            isTracked={p.puuid !== null && p.puuid === account.puuid}
          />
        ))}
      </div>
    </section>
  )

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Live game</h1>
          <p className="mt-0.5 text-sm text-text-mute">
            Checks once when you click — nothing polls in the background.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 rounded-md border border-gold-dim bg-gold/10 px-3.5 py-2 text-sm font-medium text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:border-hairline disabled:bg-transparent disabled:text-text-mute"
        >
          <Icon.Live className={isFetching ? 'animate-pulse' : undefined} />
          {isFetching ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {isError && (
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="Live game check failed"
          description={error instanceof Error ? error.message : 'Unknown error'}
        />
      )}

      {!isFetched && !isFetching && !isError && (
        <EmptyState
          icon={<Icon.Live />}
          title="Check for a game in progress"
          description={`See the full lobby and every player's rank while ${account.gameName} is in champion select or in game.`}
        />
      )}

      {data === null && !isFetching && (
        <EmptyState
          icon={<Icon.Live />}
          title="Not in a game right now"
          description={`${account.gameName} isn't in champion select or a live match. Check again once a game starts.`}
        />
      )}

      {data && (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded border border-hairline bg-surface px-2 py-0.5 text-text-dim">
              {data.gameMode}
            </span>
            <span className="tabular-nums text-text-mute">
              {Math.floor(data.gameLength / 60)} min elapsed
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {team(blue, 'Blue team', true)}
            {team(red, 'Red team', false)}
          </div>
        </>
      )}
    </div>
  )
}
