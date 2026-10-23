import clsx from 'clsx'
import type { TftLobby } from '@foxfire/core'
import { DOUBLE_UP_QUEUE_ID, countedPlacement } from '@foxfire/core'
import { formatClock } from '../../lib/matchStats'
import { formatStage } from '../../lib/tft'
import { PlacementBadge, TraitStrip, UnitStrip } from './TftBoard'

/**
 * Everybody's board in one game, best placement first — the TFT row expanded,
 * as League's expands into its scoreboard.
 *
 * The player whose history this is is picked out; anybody else this server
 * tracks can be opened, which is how a lobby leads on to a friend's profile.
 */
export function TftLobbyTable({
  lobby,
  focusPuuid,
  onOpenPlayer
}: {
  lobby: TftLobby
  /** Whose row to pick out: the player whose history the lobby was opened from. */
  focusPuuid?: string
  /** Opens a tracked player's profile. Absent where nothing can be opened. */
  onOpenPlayer?: (player: { gameName: string; tagLine: string }) => void
}): JSX.Element {
  const doubleUp = lobby.queueId === DOUBLE_UP_QUEUE_ID

  return (
    <div className="overflow-x-auto border-t border-hairline bg-canvas/40">
      <table className="w-full text-left text-sm">
        <tbody className="divide-y divide-hairline/60">
          {lobby.participants.map((p) => {
            const placement = countedPlacement(p, lobby.queueId)
            const mine = p.puuid === focusPuuid
            const name = p.gameName ? `${p.gameName}#${p.tagLine ?? ''}` : 'Unknown player'
            const canOpen = onOpenPlayer && p.accountId !== null && p.gameName && p.tagLine

            return (
              <tr key={p.puuid} className={clsx(mine && 'bg-accent/[0.06]')}>
                <td className="w-14 py-2 pl-4 align-top">
                  <PlacementBadge placement={placement} top={doubleUp ? 2 : 4} className="text-base" />
                </td>
                <td className="w-48 py-2 pr-3 align-top">
                  {canOpen ? (
                    <button
                      type="button"
                      onClick={() => onOpenPlayer({ gameName: p.gameName!, tagLine: p.tagLine! })}
                      className={clsx('truncate text-left hover:text-accent', mine ? 'text-accent' : 'text-text')}
                    >
                      {name}
                    </button>
                  ) : (
                    <p className={clsx('truncate', mine ? 'text-accent' : 'text-text-dim')}>{name}</p>
                  )}
                  <p className="text-2xs tabular-nums text-text-mute">
                    Lv {p.level} · {formatStage(p.lastRound, lobby.queueId)} · {formatClock(Math.round(p.timeEliminated))}
                  </p>
                </td>
                <td className="py-2 pr-3 align-top">
                  <TraitStrip traits={p.traits} />
                </td>
                <td className="py-2 pr-4 align-top">
                  <UnitStrip units={p.units} size="sm" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
