import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import type { Account, AdminReplay, ImportProgress, ImportResult } from '@shared/types'
import { inputClass } from './settings/controls'
import { SettingsCard, SettingsPage } from './settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from './settings/SettingsRow'
import { ghostButtonClass, primaryButtonClass } from './settings/controls'
import { EmptyState } from './EmptyState'
import * as Icon from './icons'

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
export function ServerDataSettings(): JSX.Element {
  const queryClient = useQueryClient()

  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => window.api.serverAdmin.onImportProgress(setProgress), [])

  async function runImport(): Promise<void> {
    const filePath = await window.api.serverAdmin.chooseDatabase()
    if (filePath === null) return

    setRunning(true)
    setResult(null)
    setProgress(null)

    try {
      const outcome = await window.api.serverAdmin.importDatabase(filePath)
      setResult(outcome)

      if (outcome.ok) {
        // Everything on screen is now out of date: the account list grew, and
        // every match row and rank graph has history behind it that was not
        // there a minute ago.
        void queryClient.invalidateQueries()
      }
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

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
            onClick={() => void runImport()}
            disabled={running}
          >
            <Icon.Inbox width={14} height={14} />
            {running ? 'Importing…' : 'Choose a database…'}
          </button>
        </SettingsBlock>

        {progress && <ProgressRow progress={progress} />}
        {result && <ResultRows result={result} />}
      </SettingsCard>

      <StorageCard />
      <LinkedAccountsCard />
      <ReplayLibraryCard />
    </SettingsPage>
  )
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
function LinkedAccountsCard(): JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })

  const unlink = useMutation({
    mutationFn: (accountId: string) => window.api.serverAdmin.forceUnlink(accountId),
    onSuccess: (result) => {
      if (result.ok) {
        setError(null)
        void queryClient.invalidateQueries({ queryKey: ['accounts'] })
        void queryClient.invalidateQueries({ queryKey: ['adminStorage'] })
      } else {
        setError(result.error)
      }
    }
  })

  const claimed = (accounts.data ?? []).filter((account) => account.ownerUsername != null)

  return (
    <SettingsCard
      title="Claimed League accounts"
      description={
        'Claiming is first-come and attested by a running League client, which is not proof. This is '
        + 'what makes that survivable: unlinking returns an account to unclaimed and leaves every '
        + 'game it played where it is.'
      }
    >
      {error !== null && <StatusRow tone="error">{error}</StatusRow>}

      {accounts.data !== undefined && claimed.length === 0 && (
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
          onUnlink={() => unlink.mutate(account.id)}
          unlinking={unlink.isPending && unlink.variables === account.id}
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
function StorageCard(): JSX.Element {
  const usage = useQuery({
    queryKey: ['adminStorage'],
    queryFn: () => window.api.serverAdmin.storage()
  })

  if (usage.data === undefined) return <></>

  const data = usage.data

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

      <ReplayCapRow used={data.replayBytes} />
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
function ReplayCapRow({ used }: { used: number }): JSX.Element {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string | null>(null)

  const settings = useQuery({
    queryKey: ['adminServerSettings'],
    queryFn: () => window.api.serverAdmin.getSettings()
  })

  const save = useMutation({
    mutationFn: (bytes: number) => window.api.serverAdmin.setSettings({ replayByteCap: bytes }),
    onSuccess: () => {
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ['adminServerSettings'] })
    }
  })

  const cap = settings.data?.replayByteCap ?? 0
  const shown = draft ?? (cap === 0 ? '' : (cap / GIGABYTE).toString())

  function commit(): void {
    const typed = shown.trim()
    const gigabytes = typed === '' ? 0 : Number(typed)

    if (!Number.isFinite(gigabytes) || gigabytes < 0) {
      setDraft(null)
      return
    }

    save.mutate(Math.round(gigabytes * GIGABYTE))
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
function ReplayLibraryCard(): JSX.Element {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const replays = useQuery({
    queryKey: ['adminReplays'],
    queryFn: () => window.api.serverAdmin.storedReplays()
  })

  const remove = useMutation({
    mutationFn: (matchId: string) => window.api.serverAdmin.removeReplay(matchId),
    onSuccess: (result) => {
      if (result.ok) {
        setError(null)
        void queryClient.invalidateQueries({ queryKey: ['adminReplays'] })
        void queryClient.invalidateQueries({ queryKey: ['adminStorage'] })
      } else {
        setError(result.error)
      }
    }
  })

  return (
    <SettingsCard
      title="Shared replays"
      description="The largest first, since that is where the space is. Anybody who played a game can upload its replay again afterwards."
    >
      {error !== null && <StatusRow tone="error">{error}</StatusRow>}

      {replays.data !== undefined && replays.data.length === 0 && (
        <EmptyState
          icon={<Icon.Replay />}
          title="Nothing uploaded yet"
          description="Replays appear here as members play games and Foxfire picks the files up."
        />
      )}

      {replays.data?.map((replay) => (
        <ReplayRow
          key={replay.matchId}
          replay={replay}
          onRemove={() => remove.mutate(replay.matchId)}
          removing={remove.isPending && remove.variables === replay.matchId}
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
