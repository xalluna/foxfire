import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account, Scoreboard, ScoreboardPlayer } from '@shared/types'
import { useAssetManifest, championIconUrl, championName, runeIconUrl, spellIconUrl, formatClock, positionIcon, positionLabel, Asset, EmptyState, ItemStrip, Skeleton, Icon } from '@foxfire/ui'
import { CaptureBanner } from '../components/CaptureIndicator'

/** How often the board asks the game where things stand. */
const POLL_MS = 1000

/**
 * One player, in the order the game's own scoreboard reads: who they are, then
 * what they have, then what they have done with it.
 *
 * A dead player dims and counts down over their own portrait, which is the only
 * state here that changes what a row means rather than just what it says.
 */
function PlayerRow({ p }: { p: ScoreboardPlayer }): JSX.Element {
  const assets = useAssetManifest()
  const champion =
    assets && p.championId !== null ? championName(assets, p.championId) : (p.championName ?? '')
  const icon = positionIcon(p.position)

  return (
    <div
      className={clsx(
        'flex items-center gap-2 rounded px-2 py-1',
        p.isSelf && 'bg-accent/10 ring-1 ring-inset ring-accent/25',
        p.isDead && 'opacity-60'
      )}
    >
      {icon ? (
        <Asset
          src={icon}
          className="h-4 w-4"
          rounded="rounded-none"
          title={positionLabel(p.position) ?? undefined}
        />
      ) : (
        <span className="h-4 w-4 shrink-0" />
      )}

      <div className="relative shrink-0">
        <Asset
          src={assets && p.championId !== null ? championIconUrl(assets, p.championId) : null}
          className="h-8 w-8"
          rounded="rounded-full"
          title={champion}
        />
        {p.isDead ? (
          <span className="absolute inset-0 flex items-center justify-center rounded-full bg-canvas/75 text-[10px] font-medium tabular-nums text-red">
            {Math.ceil(p.respawnTimer)}
          </span>
        ) : (
          p.level !== null && (
            <span className="absolute -bottom-0.5 -right-1 rounded-full bg-canvas px-1 text-[9px] tabular-nums text-text-dim ring-1 ring-hairline">
              {p.level}
            </span>
          )
        )}
      </div>

      <div className="flex shrink-0 flex-col gap-[2px]">
        <Asset
          src={assets && p.spell1Id !== null ? spellIconUrl(assets, p.spell1Id) : null}
          className="h-[15px] w-[15px]"
        />
        <Asset
          src={assets && p.spell2Id !== null ? spellIconUrl(assets, p.spell2Id) : null}
          className="h-[15px] w-[15px]"
        />
      </div>

      <div className="flex shrink-0 flex-col gap-[2px]">
        <Asset
          src={assets && p.keystoneId !== null ? runeIconUrl(assets, p.keystoneId) : null}
          className="h-[15px] w-[15px] bg-canvas"
          rounded="rounded-full"
        />
        <Asset
          src={assets && p.secondaryTreeId !== null ? runeIconUrl(assets, p.secondaryTreeId) : null}
          className="h-[15px] w-[15px]"
          rounded="rounded-full"
        />
      </div>

      <div className="min-w-0 flex-1">
        <p
          className={clsx(
            'truncate text-sm',
            p.isSelf ? 'font-medium text-text' : 'text-text-dim'
          )}
        >
          {p.gameName ?? champion ?? 'Unknown'}
          {p.isBot && <span className="ml-1 text-2xs text-text-mute">BOT</span>}
        </p>
        <p className="truncate text-2xs text-text-mute">{champion}</p>
      </div>

      <p className="w-[68px] shrink-0 text-sm tabular-nums">
        {p.kills}
        <span className="text-text-mute">/</span>
        <span className="text-red">{p.deaths}</span>
        <span className="text-text-mute">/</span>
        {p.assists}
      </p>

      <p className="w-12 shrink-0 text-2xs tabular-nums text-text-mute">{p.creepScore} CS</p>

      <p className="w-10 shrink-0 text-2xs tabular-nums text-text-mute">
        {Math.round(p.wardScore)} VS
      </p>

      {assets && (
        <ItemStrip
          m={assets}
          items={p.items}
          roleBound={p.roleBoundItem}
          size="h-[19px] w-[19px]"
        />
      )}

    </div>
  )
}

function Team({
  board,
  teamId,
  label
}: {
  board: Scoreboard
  teamId: number
  label: string
}): JSX.Element {
  const players = board.players.filter((p) => p.teamId === teamId)
  const kills = players.reduce((total, p) => total + p.kills, 0)
  const blue = teamId === 100

  return (
    <section className="rounded-lg border border-hairline bg-surface/40 p-2">
      <div className="mb-1 flex items-baseline gap-2 px-2">
        <span
          className={clsx(
            'text-2xs font-medium uppercase tracking-widest',
            blue ? 'text-teal' : 'text-red'
          )}
        >
          {label}
        </span>
        <span className="ml-auto text-2xs tabular-nums text-text-mute">{kills} kills</span>
      </div>
      <div className="space-y-0.5">
        {players.map((p) => (
          <PlayerRow key={p.slot} p={p} />
        ))}
      </div>
    </section>
  )
}

/**
 * The in-game scoreboard, read from the game running on this machine rather
 * than from Riot.
 *
 * That is the whole reason this screen can show levels, items and a running
 * score at all, and the whole reason it costs no Riot call and needs no API key:
 * the game is the source. It is also the whole reason it shows nothing at any
 * other time. The
 * Live Client Data API only answers while a match is actually in progress here,
 * so there is nothing to see during champion select, or when the account being
 * viewed is playing somewhere else.
 */
export function LiveGame({ account }: { account: Account }): JSX.Element {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ['scoreboard', account.id],
    queryFn: () => window.api.liveClient.scoreboard(account.id),
    // Loopback and unmetered, so a tick costs nothing. It stops the moment the
    // view unmounts, and pauses while the window is in the background — which
    // is most of a game, since the thing being watched is what has focus.
    // Tabbing back refetches on the way in, so the board is never stale when
    // anybody is actually looking at it.
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    retry: false
  })

  // A poll this fast will occasionally catch the game mid-stride. Losing one
  // tick is not worth replacing a board somebody is reading, so the error state
  // is only for having nothing to show at all — otherwise the last good board
  // stays up and says so.
  const stalled = isError && data != null

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl text-text">Live game</h1>
          <p className="mt-0.5 text-sm text-text-mute">
            Read from the game running on this PC, and updated as it plays.
          </p>
        </div>
        {data && (
          <div className="flex items-center gap-2 text-sm">
            <span className="rounded border border-hairline bg-surface px-2 py-0.5 text-text-dim">
              {data.gameMode}
            </span>
            <span className="flex items-center gap-1.5 tabular-nums text-text-mute">
              <Icon.Live
                className={clsx(stalled ? 'text-amber' : 'animate-pulse text-accent')}
              />
              {formatClock(Math.floor(data.gameTime))}
            </span>
          </div>
        )}
      </div>

      {/*
        Mid-game is when it matters and when the title bar is behind a
        fullscreen League, so the capture state is worth repeating on the one
        screen somebody alt-tabs to.
      */}
      <CaptureBanner />

      {stalled && (
        <p className="rounded border border-amber/30 bg-amber/10 px-3 py-1.5 text-2xs text-amber">
          Lost contact with the game — still trying. Showing the last reading.
        </p>
      )}

      {isError && !stalled && (
        <EmptyState
          icon={<Icon.Warning />}
          tone="error"
          title="Could not read the live game"
          description={error instanceof Error ? error.message : 'Unknown error'}
        />
      )}

      {isPending && !isError && (
        <div className="grid grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-0.5 rounded-lg border border-hairline p-2">
              {Array.from({ length: 5 }, (_, row) => (
                <Skeleton key={row} className="h-[42px] w-full" />
              ))}
            </div>
          ))}
        </div>
      )}

      {data === null && !isError && (
        <EmptyState
          icon={<Icon.Live />}
          title="No game running on this PC"
          description="The scoreboard comes from the game itself, so it fills in once a match starts on this machine. Champion select is too early, and a game being played somewhere else cannot be read from here."
        />
      )}

      {data && (
        <div className="grid grid-cols-2 gap-3">
          <Team board={data} teamId={100} label="Blue team" />
          <Team board={data} teamId={200} label="Red team" />
        </div>
      )}
    </div>
  )
}
