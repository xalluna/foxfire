import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Asset } from '../components/Asset'
import { useAssetManifest } from '../context/assetManifest'
import { ordinal } from '@foxfire/core'
import { championIconUrl, championName } from '../lib/assets'
import { formatAge, formatClock, kdaRatio } from '../lib/matchStats'
import { queueName } from '../lib/queues'
import { initials, placementTone, tftAsset, tftName } from '../lib/tft'

/** What the strip above a recording says about the game. Null wherever the game did not say. */
export interface RecordingHeaderFacts {
  championId: number | null
  championName: string | null
  queueId: number | null
  gameMode: string | null
  durationSeconds: number | null
  /** Epoch milliseconds. */
  playedAt: number | null
  /** Null for a recording that never found its match. */
  win: boolean | null
  kills: number | null
  deaths: number | null
  assists: number | null
  /**
   * A TFT game's finish and board, which the header shows in place of a
   * champion and a score. Absent for League's.
   */
  tft?: {
    /** The place that counted — the team's, in Double Up. */
    placement: number
    team: boolean
    /** The trait the board is remembered by, as Riot names it. */
    trait: string | null
    /** The unit whose portrait stands for the board, as Riot names it. */
    unit: string | null
  } | null
}

/**
 * Champion, KDA, result, and whatever can be done from here.
 *
 * The same strip over the desktop's own recording window and the web's
 * recording page, so a recording reads the same wherever it is opened. What
 * each can do differs — upload, attach a link, jump back to the history — so
 * the buttons are the caller's, in `actions`.
 */
export function RecordingHeader({
  facts,
  status,
  actions
}: {
  facts: RecordingHeaderFacts
  /** A quiet note beside the buttons: "Still looking for this game…", "Uploading 42%". */
  status?: ReactNode
  actions?: ReactNode
}): JSX.Element {
  const assets = useAssetManifest()
  const { championId, tft } = facts

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-surface px-4 py-2.5">
      {tft ? (
        <TftPortrait unit={tft.unit} />
      ) : (
        <Asset
          src={assets && championId !== null ? championIconUrl(assets, championId) : null}
          className="h-9 w-9"
          rounded="rounded-md"
        />
      )}

      <div className="min-w-0">
        <p className="truncate font-display text-base text-text">
          {tft
            ? tft.trait
              ? tftName(assets, 'traits', tft.trait)
              : 'Recording'
            : assets && championId !== null
              ? championName(assets, championId, facts.championName)
              : (facts.championName ?? 'Recording')}
        </p>
        <p className="text-2xs text-text-mute">
          {queueName(facts.queueId, facts.gameMode)}
          {' · '}
          {facts.durationSeconds !== null ? formatClock(Math.round(facts.durationSeconds)) : '—'}
          {facts.playedAt !== null && (
            <>
              {' · '}
              {formatAge(facts.playedAt)}
            </>
          )}
        </p>
      </div>

      {tft && <PlacementChip placement={tft.placement} team={tft.team} />}

      {!tft && facts.win !== null && (
        <span
          className={clsx(
            'ml-2 rounded border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide',
            facts.win ? 'border-teal/30 bg-teal/10 text-teal' : 'border-red/30 bg-red/10 text-red'
          )}
        >
          {facts.win ? 'Victory' : 'Defeat'}
        </span>
      )}

      {facts.kills !== null && facts.deaths !== null && facts.assists !== null && (
        <span className="text-sm tabular-nums text-text-dim">
          {facts.kills} / <span className="text-red">{facts.deaths}</span> / {facts.assists}
          <span className="ml-1.5 text-text-mute">
            {kdaRatio(facts.kills, facts.deaths, facts.assists)} KDA
          </span>
        </span>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        {status && <span className="text-2xs text-text-mute">{status}</span>}
        {actions}
      </div>
    </header>
  )
}

/** The board's face: its carry's portrait, or the carry's initials where Data Dragon has none. */
function TftPortrait({ unit }: { unit: string | null }): JSX.Element {
  const assets = useAssetManifest()
  const portrait = unit ? (tftAsset(assets, 'units', unit)?.image ?? null) : null

  if (portrait || !unit) return <Asset src={portrait} className="h-9 w-9" rounded="rounded-md" />
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-2xs font-semibold text-text-dim">
      {initials(tftName(assets, 'units', unit))}
    </span>
  )
}

/** "3rd", or "2nd team" in Double Up, in the colour of how it went. */
function PlacementChip({ placement, team }: { placement: number; team: boolean }): JSX.Element {
  const tone = placementTone(placement, team ? 2 : 4)

  return (
    <span
      className={clsx(
        'ml-2 rounded border px-2 py-0.5 text-2xs font-medium uppercase tracking-wide tabular-nums',
        tone === 'first'
          ? 'border-gold/30 bg-gold/10 text-gold'
          : tone === 'top'
            ? 'border-teal/30 bg-teal/10 text-teal'
            : 'border-red/30 bg-red/10 text-red'
      )}
    >
      {ordinal(placement)}
      {team && ' team'}
    </span>
  )
}

/** The button style the header's actions share. */
export const recordingActionClass =
  'rounded-md border border-hairline px-3 py-1.5 text-sm text-text-dim transition hover:border-accent-dim hover:text-accent disabled:cursor-not-allowed disabled:opacity-40'

export const recordingPrimaryActionClass =
  'rounded-md border border-accent-dim bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition hover:bg-accent/20'
