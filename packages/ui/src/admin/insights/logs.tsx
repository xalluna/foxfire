import clsx from 'clsx'
import type { ServerLogEntry, ServerLogQuery } from '@foxfire/core'
import { Segmented } from '../../components/Segmented'
import { ShowMoreButton } from '../../components/ShowMore'
import { Chip, count, type Tone } from './parts'

export type LogLevelFilter = NonNullable<ServerLogQuery['level']>

export interface InsightsLogsProps {
  /** The pages fetched so far, newest first. Undefined while the first loads. */
  entries: ServerLogEntry[] | undefined
  total: number
  level: LogLevelFilter
  onLevel: (level: LogLevelFilter) => void
  hasMore: boolean
  loadingMore: boolean
  onShowMore: () => void
}

const LEVEL_TONE: Record<ServerLogEntry['level'], Tone> = {
  information: 'normal',
  warning: 'warn',
  error: 'bad',
  fatal: 'bad'
}

/**
 * The server's recent log lines.
 *
 * What is in memory — the last couple of thousand lines, and the last five
 * hundred warnings and errors kept apart so a busy afternoon does not push them
 * out. The blob store holds the rest for good; this is the part worth a glance,
 * and the trace id on each is what finds the rest of that request there.
 */
export function LogsTab({
  entries,
  total,
  level,
  onLevel,
  hasMore,
  loadingMore,
  onShowMore
}: InsightsLogsProps): JSX.Element {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented<LogLevelFilter>
          size="sm"
          value={level}
          onChange={onLevel}
          options={[
            ['error', 'Errors'],
            ['warning', 'Warnings'],
            ['information', 'Everything']
          ]}
        />
        {entries !== undefined && (
          <p className="text-2xs text-text-mute">
            {count(entries.length)} of {count(total)} kept in memory
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
        {entries === undefined ? (
          <p className="px-4 py-6 text-center text-sm text-text-mute">Loading…</p>
        ) : entries.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-text-mute">
            {level === 'information' ? 'Nothing logged since the server started.' : 'Nothing like that since the server started.'}
          </p>
        ) : (
          <ol className="divide-y divide-hairline">
            {entries.map((entry) => (
              <LogLine key={entry.seq} entry={entry} />
            ))}
          </ol>
        )}
        {hasMore && <ShowMoreButton onClick={onShowMore} loading={loadingMore} />}
      </div>
    </div>
  )
}

function LogLine({ entry }: { entry: ServerLogEntry }): JSX.Element {
  return (
    <li className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-text-mute">
        <time dateTime={entry.at} className="font-mono">
          {formatLogTime(entry.at)}
        </time>
        <Chip tone={LEVEL_TONE[entry.level]}>{entry.level}</Chip>
        {entry.source && <span>{entry.source}</span>}
        {entry.traceId && (
          <span className="ml-auto select-all font-mono" title="Finds this request in the stored logs">
            {entry.traceId}
          </span>
        )}
      </div>
      <p
        className={clsx(
          'mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed',
          entry.level === 'information' ? 'text-text-dim' : 'text-text'
        )}
      >
        {entry.message}
      </p>
      {entry.exception && (
        <details className="mt-1">
          <summary className="cursor-pointer text-2xs text-text-mute hover:text-accent">
            {entry.exception.split('\n', 1)[0]}
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded border border-hairline bg-canvas p-2 text-2xs leading-relaxed text-text-dim">
            {entry.exception}
          </pre>
        </details>
      )}
    </li>
  )
}

/** The clock, and the day too when it was not today. */
function formatLogTime(at: string): string {
  const d = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

  return d.toDateString() === new Date().toDateString()
    ? clock
    : `${d.getDate()}/${d.getMonth() + 1} ${clock}`
}
