import { useEffect, useState } from 'react'
import type { Account, QueueType, RankRange } from '@foxfire/core'
import type { MatchFocus } from '@foxfire/ui'
import { ChampionsScreen, DashboardScreen, RankScreen } from '@foxfire/screens'
import { useUiStore } from '../store/uiStore'

/*
 * The shared account screens, hosted the way this app hosts them.
 *
 * Each screen takes the state that decides what it shows — a queue, a period —
 * as props, because whether that state survives leaving the page is the app's
 * decision rather than the screen's. Here the queue filters live in the UI
 * store, so they last for the session and reset on every launch; the rank
 * page's choices are local, so they reset whenever it is left.
 */

export function DashboardView({ account }: { account: Account }): JSX.Element {
  const queueId = useUiStore((s) => s.matchQueueFilter)
  const setQueueId = useUiStore((s) => s.setMatchQueueFilter)
  const [focus, setFocus] = useState<MatchFocus | null>(null)

  /**
   * A recording window asking to show its match.
   *
   * The window that made the request is a different renderer process with its
   * own query cache, so it cannot expand a row here itself — it sends a message
   * and the main process forwards it, the same arrangement the LP editor uses
   * to focus a row. A fresh object each time, so asking twice works twice.
   */
  useEffect(
    () =>
      window.api.recordings.onShowMatch((accountId, matchId) => {
        if (accountId === account.id) setFocus({ matchId })
      }),
    [account.id]
  )

  return (
    <DashboardScreen account={account} queueId={queueId} onQueueChange={setQueueId} focus={focus} />
  )
}

export function ChampionsView({ account }: { account: Account }): JSX.Element {
  const queueId = useUiStore((s) => s.championQueueFilter)
  const setQueueId = useUiStore((s) => s.setChampionQueueFilter)
  // Null until somebody picks a period, so the screen opens on the newest
  // ranked year that has games.
  const [range, setRange] = useState<RankRange | null>(null)

  return (
    <ChampionsScreen
      account={account}
      queueId={queueId}
      onQueueChange={setQueueId}
      range={range}
      onRangeChange={setRange}
    />
  )
}

export function RankView({ account }: { account: Account }): JSX.Element {
  const [queueType, setQueueType] = useState<QueueType>('RANKED_SOLO_5x5')
  const [range, setRange] = useState<RankRange>('30d')

  return (
    <RankScreen
      account={account}
      queueType={queueType}
      onQueueTypeChange={setQueueType}
      range={range}
      onRangeChange={setRange}
    />
  )
}
