import { useState } from 'react'
import clsx from 'clsx'
import type {
  Account,
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
import * as Icon from '../components/icons'

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
  }

  storage: ServerStorageUsage | undefined
  /** In bytes. Zero is no cap. Undefined while the settings are loading. */
  replayCap: number | undefined
  onSaveReplayCap: (bytes: number) => Promise<void>

  /** Every League account on the server, of which the claimed ones are listed. */
  accounts: Account[] | undefined
  onUnlink: (accountId: string) => Promise<AdminActionResult>

  replays: AdminReplay[] | undefined
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
 */
export function ServerDataPage({
  importer,
  storage,
  replayCap,
  onSaveReplayCap,
  accounts,
  onUnlink,
  replays,
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
            + 'the API key that asked for them. That costs one Riot request per account; the rest runs '
            + 'at the speed of the server. Running it twice is safe — nothing is imported over itself.'
          }
        >
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
      <LinkedAccountsCard accounts={accounts} onUnlink={onUnlink} />
      <ReplayLibraryCard replays={replays} onRemove={onRemoveReplay} />
    </SettingsPage>
  )
}

/**
 * Tracks one refusable action per row: which row is in flight, and the
 * server's reason the last one was refused.
 */
function useRowAction(run: (id: string) => Promise<AdminActionResult>): {
  pendingId: string | null
  error: string | null
  start: (id: string) => void
} {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  return {
    pendingId,
    error,
    start: (id) => {
      setPendingId(id)
      run(id)
        .then((result) => setError(result.ok ? null : result.error))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setPendingId(null))
    }
  }
}

/**
 * Who has claimed which League account, and the way to take one back.
 *
 * Claiming is first-come and LCU-attested, which is not proof — a hand-written
 * HTTP client can claim any Riot ID — and the trade is deliberate: it costs an
 * honest person nothing. What makes it survivable is this. Without a way to
 * unlink, somebody claiming an account that is not theirs, or leaving the
 * community still holding one, is permanent.
 *
 * The account and its games stay; only the claim goes. History on a Foxfire
 * server belongs to the server, and whoever the account really belongs to
 * claims it again the ordinary way.
 */
function LinkedAccountsCard({
  accounts,
  onUnlink
}: {
  accounts: Account[] | undefined
  onUnlink: (accountId: string) => Promise<AdminActionResult>
}): JSX.Element {
  const unlink = useRowAction(onUnlink)
  const claimed = (accounts ?? []).filter((account) => account.ownerUsername != null)

  return (
    <SettingsCard
      title="Claimed League accounts"
      description={
        'Claiming is first-come and attested by a running League client, which is not proof. This is '
        + 'what makes that survivable: unlinking returns an account to unclaimed and leaves every '
        + 'game it played where it is.'
      }
    >
      {unlink.error !== null && <StatusRow tone="error">{unlink.error}</StatusRow>}

      {accounts !== undefined && claimed.length === 0 && (
        <EmptyState
          icon={<Icon.Server />}
          title="Nobody has claimed an account yet"
          description="Members claim their own by signing in to the League client with Foxfire connected."
        />
      )}

      {claimed.map((account) => (
        <LinkedAccountRow
          key={account.id}
          account={account}
          onUnlink={() => unlink.start(account.id)}
          unlinking={unlink.pendingId === account.id}
        />
      ))}
    </SettingsCard>
  )
}

function LinkedAccountRow({
  account,
  onUnlink,
  unlinking
}: {
  account: Account
  onUnlink: () => void
  unlinking: boolean
}): JSX.Element {
  return (
    <SettingsRow
      label={`${account.gameName}#${account.tagLine}`}
      description={`Claimed by ${account.ownerUsername}`}
      control={
        <button type="button" className={ghostButtonClass} onClick={onUnlink} disabled={unlinking}>
          {unlinking ? 'Unlinking…' : 'Unlink'}
        </button>
      }
    />
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
 * The library, biggest first, with a way to remove one.
 *
 * Biggest rather than newest because the reason to open this list is that space
 * is needed, and nobody hunting for space scrolls past the first screen. Removal
 * is per replay and there is no "delete everything": the failure mode of a full
 * store is a refused upload, which is recoverable, and one click between a
 * community and its library is not.
 */
function ReplayLibraryCard({
  replays,
  onRemove
}: {
  replays: AdminReplay[] | undefined
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

/** Where the run has got to, named for what it is actually doing. */
function ProgressRow({ progress }: { progress: ImportProgress }): JSX.Element {
  const label: Record<ImportProgress['phase'], string> = {
    accounts: 'Re-resolving accounts with Riot',
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

  // Pluralised, because every one of these can legitimately be one: a server
  // imported from a single account's database, a file with one season in it.
  const counts: Array<[string, string, number]> = [
    ['account', 'accounts', result.accounts],
    ['match', 'matches', result.matches],
    ['rank reading', 'rank readings', result.readings],
    ['season', 'seasons', result.seasons]
  ]

  return (
    <>
      <StatusRow tone="good">
        Imported {counts.map(([one, many, n]) => `${n} ${n === 1 ? one : many}`).join(', ')} —
        and worked out LP for {result.attributed}{' '}
        {result.attributed === 1 ? 'game' : 'games'}.
      </StatusRow>

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
