import { useState } from 'react'
import clsx from 'clsx'
import { RecordingsTab } from './captures/RecordingsTab'
import { ReplaysTab } from './captures/ReplaysTab'
import type { Account } from '@shared/types'

/**
 * Everything Foxfire keeps of a game after it ends, in two tabs.
 *
 * They are separated rather than merged because they are genuinely different
 * things that happen to arrive at the same moment. A **recording** is an OBS
 * video of the player's own screen — one point of view, playable anywhere, and
 * measured in gigabytes. A **replay** is Riot's .rofl: a command log the game
 * engine re-runs, so it carries every player's perspective and a free camera,
 * costs about thirty megabytes, and is worthless to anything but a League
 * client on the exact patch that produced it.
 *
 * One list holding both would have to explain that difference on every row.
 * Two tabs explain it once.
 *
 * The tab strip follows the underline idiom the telemetry panel already uses,
 * rather than the pill nav in the header — these are sections of one screen,
 * not destinations.
 */
type Tab = 'recordings' | 'replays'

const TABS: Array<[Tab, string]> = [
  ['recordings', 'Recordings'],
  ['replays', 'Replays']
]

export function Captures({ account }: { account: Account }): JSX.Element {
  const [tab, setTab] = useState<Tab>('recordings')

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <h1 className="font-display text-xl text-text">Captures</h1>

      <div className="mt-4 flex gap-4 border-b border-hairline" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={clsx(
              '-mb-px border-b-2 px-1 pb-2 text-sm transition',
              tab === id
                ? 'border-accent text-accent'
                : 'border-transparent text-text-mute hover:text-text-dim'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'recordings' ? (
          <RecordingsTab account={account} />
        ) : (
          <ReplaysTab account={account} />
        )}
      </div>
    </div>
  )
}
