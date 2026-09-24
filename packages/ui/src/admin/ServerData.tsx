import { useState } from 'react'
import clsx from 'clsx'
import type {
  AdminActionResult,
  AdminReplay,
  ImportProgress,
  ImportResult,
  ServerStorageUsage
} from '@foxfire/core'
import { inputClass } from '../components/settings/controls'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, primaryButtonClass } from '../components/settings/controls'
import { EmptyState } from '../components/EmptyState'
import { ShowMoreButton } from '../components/ShowMore'
import * as Icon from '../components/icons'
import { formatAge } from '../lib/matchStats'
import { useRowAction } from './rowAction'

export interface ServerDataPageProps {
  /**
   * The import, when this client can read a stats.db at all. Running it — the
   * file picker, reading the file, the minutes of batches — is the caller's;
   * the page shows where it has got to.
   */
  importer?: {
    running: boolean
    progress: ImportProgress | null
    result: ImportResult | null
    onStart: () => void
    /**
     * Set when the file is read by a browser. It sees only the file that was
     * picked, not the write-ahead log SQLite keeps beside it while Foxfire is
     * running — so the newest games can be missing, and the page says so.
     */
    inBrowser?: boolean
  }

  storage: ServerStorageUsage | undefined
  /** In bytes. Zero is no cap. Undefined while the settings are loading. */
  replayCap: number | undefined
  onSaveReplayCap: (bytes: number) => Promise<void>

  /** The pages of the replay library fetched so far, biggest first. Undefined while the first loads. */
  replays: AdminReplay[] | undefined
  /** Whether there is another page of the library after `replays`. */
  hasMoreReplays: boolean
  loadingMoreReplays: boolean
  onShowMoreReplays: () => void
  onRemoveReplay: (matchId: string) => Promise<AdminActionResult>
}

/**
 * Moving an existing Foxfire database into the server.
 *
 * Its own page rather than a card on Server management, because the two are
 * about different things: that page is people and access, and this is the
 * community's data. It is also the only place in Settings where a button starts
 * something that runs for minutes.
 *
 * What it does not offer is a way out. There is no export and no undo — an
 * import only ever adds, every batch skips what has already landed, and running
 * the same file twice is free. That is what makes the absence of a rollback
 * acceptable rather than an omission.
 *
 * It is also how a server is kept current. Keep using Foxfire on your own PC for
 * a few days, choose the newer copy of the same file, and what lands is what is
 * new. The result says so in both directions — what was added and what the
 * server already had — because a run that adds nothing has to be told apart from
 * one that could not read the file.
 */
export function ServerDataPage({
  importer,
  storage,
  replayCap,
  onSaveReplayCap,
  replays,
  hasMoreReplays,
  loadingMoreReplays,
  onShowMoreReplays,
  onRemoveReplay
}: ServerDataPageProps): JSX.Element {
  return (
    <SettingsPage
      title="Data & storage"
      // SettingsPage puts this inside a <p>, so a paragraph break is a <br />
      // pair rather than a second one. Nested paragraphs are invalid HTML and
      // React says so at runtime.
      intro={
        <>
          Bring an existing Foxfire database onto this server — everything in a{' '}
          <code className="text-text">stats.db</code> except the parts that belong to one machine.
          Accounts, match history, rank readings and season boundaries come across; recordings and
          Riot replays stay on the PC they are on.
          <br />
          <br />
          Imported League accounts arrive unclaimed. The file says which accounts its owner played;
          it does not say who on this server they are, and on a server that is something the League
          client attests to rather than something an import can assert. The history is here either
          way, and claiming an account is the ordinary link.
        </>
      }
    >
      {importer && (
        <SettingsCard
          title="Import"
          description={
            'Every player id in the file has to be resolved again, because Riot encrypts them against '
            + 'the API key that asked for them. That costs one Riot request per account the server has '
            + 'not met before; the rest runs at the speed of the server. To bring the server up to date '
            + 'later, choose a newer copy of the same file — only what is new is sent, and nothing is '
            + 'imported over itself.'
          }
        >
          {importer.inBrowser && (
            <StatusRow tone="mute">
              A browser reads only the file you choose, not the changes Foxfire keeps beside it while it
              is running. Close Foxfire on that PC first — or import from the desktop app — or the newest
              games can be missing.
            </StatusRow>
          )}

          <SettingsBlock>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={importer.onStart}
              disabled={importer.running}
            >
              <Icon.Inbox width={14} height={14} />
              {importer.running ? 'Importing…' : 'Choose a database…'}
            </button>
          </SettingsBlock>

          {importer.progress && <ProgressRow progress={importer.progress} />}
          {importer.result && <ResultRows result={importer.result} />}
        </SettingsCard>
      )}

      {storage !== undefined && (
        <StorageCard storage={storage} replayCap={replayCap} onSaveReplayCap={onSaveReplayCap} />
      )}
      <ReplayLibraryCard
        replays={replays}
        hasMore={hasMoreReplays}
        loadingMore={loadingMoreReplays}
        onShowMore={onShowMoreReplays}
        onRemove={onRemoveReplay}
      />
    </SettingsPage>
  )
}

/**
 * What the server is holding, and where.
 *
 * The two halves are not symmetrical and the copy says so. A deduplicated match
 * history takes a long time to trouble SQL Server Express's 10 GB, because a
 * game ten people played is one row; replays are tens of megabytes each and are
 * what will actually fill a volume.
 */
function StorageCard({
  storage: data,
  replayCap,
  onSaveReplayCap
}: {
  storage: ServerStorageUsage
  replayCap: number | undefined
  onSaveReplayCap: (bytes: number) => Promise<void>
}): JSX.Element {
  return (
    <SettingsCard
      title="What this server is holding"
      description={
        'Matches are stored once and shared by everybody who played them, so the database grows '
        + 'with the community rather than with each person in it. Replays do not — every one is its '
        + 'own file.'
      }
    >
      <SettingsRow
        label="Replays"
        description="In the blob store, as the store counts them."
        control={
          <span className="text-sm tabular-nums text-text">
            {data.replaysConfigured
              ? `${data.replayCount} · ${gigabytes(data.replayBytes)}`
              : 'Not set up'}
          </span>
        }
      />

      {data.replaysConfigured && data.replayRecords !== data.replayCount && (
        // The store is the one that is right about disk. A disagreement means a
        // delete failed or an upload was abandoned, and saying so beats quietly
        // showing whichever number was asked for first.
        <StatusRow tone="warn">
          The server has {data.replayRecords} replay {data.replayRecords === 1 ? 'record' : 'records'}{' '}
          but the store holds {data.replayCount}. Something was deleted from one and not the other.
        </StatusRow>
      )}

      <SettingsRow
        label="Matches"
        description="Each one shared by everybody in it."
        control={
          <span className="text-sm tabular-nums text-text">
            {data.matches.toLocaleString()} · {data.matchParticipants.toLocaleString()} player rows
          </span>
        }
      />

      <SettingsRow
        label="Rank readings"
        description="What every LP figure is derived from."
        control={
          <span className="text-sm tabular-nums text-text">{data.rankReadings.toLocaleString()}</span>
        }
      />

      <SettingsRow
        label="League accounts"
        description="Unclaimed ones are usually imported, waiting for their owner to link them."
        control={
          <span className="text-sm tabular-nums text-text">
            {data.riotAccounts} · {data.unclaimedAccounts} unclaimed
          </span>
        }
      />

      <ReplayCapRow used={data.replayBytes} cap={replayCap ?? 0} onSave={onSaveReplayCap} />
    </SettingsCard>
  )
}

/**
 * How much of the store replays may take.
 *
 * In gigabytes, because that is the unit a volume or a storage bill is thought
 * about in, and nobody wants to count zeroes. Blank or zero means no cap, which
 * is the default: what a cap prevents is an upload being refused, and a cap is
 * how an upload gets refused — so it only earns its place when a host would
 * rather choose the moment themselves.
 */
function ReplayCapRow({
  used,
  cap,
  onSave
}: {
  used: number
  cap: number
  onSave: (bytes: number) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const shown = draft ?? (cap === 0 ? '' : (cap / GIGABYTE).toString())

  function commit(): void {
    const typed = shown.trim()
    const gigabytes = typed === '' ? 0 : Number(typed)

    if (!Number.isFinite(gigabytes) || gigabytes < 0) {
      setDraft(null)
      return
    }

    void onSave(Math.round(gigabytes * GIGABYTE)).then(() => setDraft(null))
  }

  return (
    <SettingsRow
      label="Replay storage cap"
      description={
        cap === 0
          ? 'No cap. Uploads are refused only when the store itself fills up.'
          : `Uploads stop once replays reach this. ${gigabytes(used)} of ${gigabytes(cap)} used.`
      }
      control={
        <div className="flex items-center gap-2">
          <input
            value={shown}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
            placeholder="none"
            inputMode="decimal"
            className={clsx(inputClass, 'w-20 text-right tabular-nums')}
          />
          <span className="text-sm text-text-mute">GB</span>
        </div>
      }
    />
  )
}

const GIGABYTE = 1024 * 1024 * 1024

/**
 * The library, biggest first, a page at a time, with a way to remove one.
 *
 * Biggest rather than newest because the reason to open this list is that space
 * is needed, and somebody hunting for space rarely gets past the first page —
 * but can, for the one replay they came to delete. Removal is per replay and
 * there is no "delete everything": the failure mode of a full store is a
 * refused upload, which is recoverable, and one click between a community and
 * its library is not.
 */
function ReplayLibraryCard({
  replays,
  hasMore,
  loadingMore,
  onShowMore,
  onRemove
}: {
  replays: AdminReplay[] | undefined
  hasMore: boolean
  loadingMore: boolean
  onShowMore: () => void
  onRemove: (matchId: string) => Promise<AdminActionResult>
}): JSX.Element {
  const remove = useRowAction(onRemove)

  return (
    <SettingsCard
      title="Shared replays"
      description="The largest first, since that is where the space is. Anybody who played a game can upload its replay again afterwards."
    >
      {remove.error !== null && <StatusRow tone="error">{remove.error}</StatusRow>}

      {replays !== undefined && replays.length === 0 && (
        <EmptyState
          icon={<Icon.Replay />}
          title="Nothing uploaded yet"
          description="Replays appear here as members play games and Foxfire picks the files up."
        />
      )}

      {replays?.map((replay) => (
        <ReplayRow
          key={replay.matchId}
          replay={replay}
          onRemove={() => remove.start(replay.matchId)}
          removing={remove.pendingId === replay.matchId}
        />
      ))}

      {hasMore && <ShowMoreButton variant="settings" onClick={onShowMore} loading={loadingMore} />}
    </SettingsCard>
  )
}

function ReplayRow({
  replay,
  onRemove,
  removing
}: {
  replay: AdminReplay
  onRemove: () => void
  removing: boolean
}): JSX.Element {
  return (
    <SettingsRow
      label={replay.matchId}
      description={[
        replay.patch === null ? 'Patch unknown' : `Patch ${replay.patch}`,
        replay.uploadedBy === null ? 'uploader has left' : `uploaded by ${replay.uploadedBy}`
      ].join(' · ')}
      control={
        <div className="flex items-center gap-3">
          <span className="text-sm tabular-nums text-text-dim">{megabytes(replay.fileBytes)}</span>
          <button type="button" className={ghostButtonClass} onClick={onRemove} disabled={removing}>
            <Icon.Trash width={13} height={13} />
            {removing ? 'Removing…' : 'Remove'}
          </button>
        </div>
      }
    />
  )
}

/** Gigabytes to one place, which is the unit a volume is thought about in. */
function gigabytes(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function megabytes(bytes: number | null): string {
  if (bytes === null) return '—'
  return `${Math.round(bytes / (1024 * 1024))} MB`
}

/**
 * "12 matches", pluralised — because every one of these can legitimately be
 * one: a server imported from a single account's database, a file with one
 * season in it.
 */
function count(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

/** The non-zero counts, spelled out; a zero is left out rather than said. */
function tally(counts: Array<[number, string, string]>): string[] {
  return counts.filter(([n]) => n > 0).map(([n, one, many]) => count(n, one, many))
}

/** A moment from the file, with how long ago that was, or that it has none. */
function when(timestamp: number | null): string {
  if (timestamp === null) return 'none'

  const date = new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })

  return `${date} (${formatAge(timestamp)})`
}

/** Where the run has got to, named for what it is actually doing. */
function ProgressRow({ progress }: { progress: ImportProgress }): JSX.Element {
  const label: Record<ImportProgress['phase'], string> = {
    accounts: 'Re-resolving accounts with Riot',
    comparing: 'Checking which games the server already has',
    matches: 'Storing matches',
    readings: 'Storing rank readings',
    finishing: 'Working out LP',
    done: 'Finished'
  }

  // One sentence rather than a label and a right-aligned count: StatusRow puts
  // its children in a single span beside an icon, so there is nothing for a
  // count to be pushed away from.
  return (
    <StatusRow tone="mute">
      {label[progress.phase]}
      {progress.total > 0 && (
        <span className="tabular-nums">
          {' — '}
          {progress.current} of {progress.total}
        </span>
      )}
    </StatusRow>
  )
}

/** The tally, and the accounts that still need a person. */
function ResultRows({ result }: { result: ImportResult }): JSX.Element {
  if (!result.ok) {
    return <StatusRow tone="error">{result.message ?? 'The import could not be completed.'}</StatusRow>
  }

  const added = tally([
    [result.matches, 'match', 'matches'],
    [result.readings, 'rank reading', 'rank readings'],
    [result.seasons, 'season', 'seasons']
  ])

  const had = tally([
    [result.alreadyThere.matches, 'match', 'matches'],
    [result.alreadyThere.readings, 'rank reading', 'rank readings'],
    [result.alreadyThere.seasons, 'season', 'seasons']
  ])

  // Both directions, always. "Imported 0 matches" cannot tell a server that
  // already has everything from a file that could not be read, and a person who
  // re-sent a file after three days has to be able to tell which one happened.
  const summary = [
    added.length > 0 ? `Added ${added.join(', ')}` : 'Nothing new to add',
    result.attributed > 0
      ? ` — and worked out LP for ${count(result.attributed, 'game', 'games')}`
      : '',
    '.',
    had.length > 0 ? ` Already on the server: ${had.join(', ')}.` : ''
  ].join('')

  const nothingAdded = added.length === 0

  return (
    <>
      <StatusRow tone="good">{summary}</StatusRow>

      {/* What the file itself held. The newest game is the tell for a copy that
          stops where the last one did — the browser missing Foxfire's latest
          writes looks exactly like a server that is up to date, until this. */}
      <StatusRow tone="mute">
        In this file: {count(result.accounts, 'account', 'accounts')} the server recognises; newest
        game {when(result.newest.matchAt)}; newest rank reading {when(result.newest.readingAt)}.
        {nothingAdded &&
          ' If that is older than you expected, this copy is missing Foxfire’s latest changes — close Foxfire on that PC and choose the file again.'}
      </StatusRow>

      {result.healed > 0 && (
        // Games an earlier run stored when it could not yet tell whose they
        // were. Said out loud because it is the one thing an import does to rows
        // that were already there.
        <StatusRow tone="good">
          Moved {count(result.healed, 'game', 'games')} imported earlier onto the account{' '}
          {result.healed === 1 ? 'it belongs' : 'they belong'} to, now that the server can resolve it.
        </StatusRow>
      )}

      {result.matchesFailed > 0 && (
        <StatusRow tone="warn">
          {count(result.matchesFailed, 'game', 'games')} in the file could not be read by the server and{' '}
          {result.matchesFailed === 1 ? 'was' : 'were'} left out.
        </StatusRow>
      )}

      {result.readingsUnplaced > 0 && (
        <StatusRow tone="warn">
          {count(result.readingsUnplaced, 'rank reading', 'rank readings')} left out: the account{' '}
          {result.readingsUnplaced === 1 ? 'it belongs' : 'they belong'} to could not be resolved, or
          the queue is not one this server tracks.
        </StatusRow>
      )}

      {result.unresolved.length > 0 && (
        // Named rather than counted. The fix is to add each one under the name
        // it plays under now, and a number cannot tell anybody which.
        <StatusRow tone="warn">
          Riot no longer knows {result.unresolved.join(', ')} — most likely renamed. Their history
          is here; link them under the name they play under now.
        </StatusRow>
      )}
    </>
  )
}
