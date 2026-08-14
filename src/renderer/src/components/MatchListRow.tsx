import { formatDistanceToNow } from 'date-fns'
import type { MatchSummary } from '@shared/types'
import { useAssets } from '../hooks/useAssets'
import { championIconUrl, championName } from '../lib/assets'

// Only the queues worth naming; anything else falls back to the raw game mode.
const QUEUE_NAMES: Record<number, string> = {
  400: 'Normal Draft',
  420: 'Ranked Solo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  700: 'Clash',
  1700: 'Arena',
  1900: 'URF'
}

export function MatchListRow({
  match,
  expanded,
  onToggle
}: {
  match: MatchSummary
  expanded: boolean
  onToggle: () => void
}): JSX.Element {
  const assets = useAssets()
  const icon = assets ? championIconUrl(assets, match.championId) : null
  const name = assets
    ? championName(assets, match.championId, match.championName)
    : (match.championName ?? '')

  const kda =
    match.deaths === 0
      ? 'Perfect'
      : ((match.kills + match.assists) / match.deaths).toFixed(2)

  const queueLabel = QUEUE_NAMES[match.queueId ?? -1] ?? match.gameMode ?? 'Game'
  const durationMin = Math.floor(match.gameDuration / 60)
  const durationSec = String(match.gameDuration % 60).padStart(2, '0')

  return (
    <button
      onClick={onToggle}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-slate-800/40 ${
        match.win ? 'border-l-2 border-l-sky-500' : 'border-l-2 border-l-rose-500'
      }`}
    >
      {icon ? (
        <img src={icon} alt="" className="h-10 w-10 shrink-0 rounded-md" />
      ) : (
        <div className="h-10 w-10 shrink-0 rounded-md bg-slate-800" />
      )}

      <div className="w-32 min-w-0">
        <p className="truncate text-sm font-medium text-slate-200">{name}</p>
        <p className="text-[11px] text-slate-500">{queueLabel}</p>
      </div>

      <div className="w-24">
        <p className="text-sm tabular-nums text-slate-200">
          {match.kills} / <span className="text-rose-400">{match.deaths}</span> / {match.assists}
        </p>
        <p className="text-[11px] text-slate-500">{kda} KDA</p>
      </div>

      <div className="w-16">
        <p className={`text-sm font-medium ${match.win ? 'text-sky-400' : 'text-rose-400'}`}>
          {match.win ? 'Win' : 'Loss'}
        </p>
        <p className="text-[11px] tabular-nums text-slate-500">
          {durationMin}:{durationSec}
        </p>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="text-[11px] text-slate-500">
          {formatDistanceToNow(new Date(match.gameCreation), { addSuffix: true })}
        </span>
        <span
          className={`text-slate-600 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        >
          ▾
        </span>
      </div>
    </button>
  )
}
