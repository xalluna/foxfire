import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ImportProgress, ImportResult } from '@shared/types'
import { SettingsCard, SettingsPage } from './settings/SettingsCard'
import { SettingsBlock, StatusRow } from './settings/SettingsRow'
import { primaryButtonClass } from './settings/controls'
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
      intro={
        <>
          <p>
            Bring an existing Foxfire database onto this server — everything in a{' '}
            <code className="text-text">stats.db</code> except the parts that belong to one machine.
            Accounts, match history, rank readings and season boundaries come across; recordings and
            Riot replays stay on the PC they are on.
          </p>
          <p>
            Imported League accounts arrive unclaimed. The file says which accounts its owner
            played; it does not say who on this server they are, and on a server that is something
            the League client attests to rather than something an import can assert. The history is
            here either way, and claiming an account is the ordinary link.
          </p>
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
    </SettingsPage>
  )
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
