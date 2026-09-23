import { useState } from 'react'
import clsx from 'clsx'
import type { Account, AdminActionResult, RiotIdInput } from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass } from '../components/settings/controls'
import { parseRiotId, formatRiotId } from '../lib/riotId'
import { randomExampleRiotId } from '../lib/exampleRiotId'
import { EmptyState } from '../components/EmptyState'
import * as Icon from '../components/icons'
import { useRowAction } from './rowAction'

export interface LeagueAccountsPageProps {
  /** Every League account on the server, claimed or not. */
  accounts: Account[] | undefined

  /**
   * Starts tracking an account nobody here has claimed, and backfills it.
   * Throws with the server's reason when the Riot ID resolves to nothing, or
   * to somebody this server already has.
   */
  onAddAccount: (input: RiotIdInput) => Promise<Account>

  /** Returns an account to unclaimed. Its games stay where they are. */
  onUnlink: (accountId: string) => Promise<AdminActionResult>
}

/**
 * The League accounts this server keeps history for, and who owns them.
 *
 * Its own page rather than two cards on Data & storage, for the reason Members
 * and Invites are two pages: a community's accounts outnumber its members, and
 * an admin looking for the box that adds one should not scroll past the replay
 * library to reach it.
 *
 * The two halves are the same subject from opposite ends. Tracking is what the
 * server collects and an admin decides; claiming is which member says an
 * account is theirs, which they decide and an admin can only undo. An account
 * can be tracked and unclaimed forever — that is the ordinary state of one an
 * admin added, and of every account an import brought across.
 */
export function LeagueAccountsPage({
  accounts,
  onAddAccount,
  onUnlink
}: LeagueAccountsPageProps): JSX.Element {
  return (
    <SettingsPage
      title="League accounts"
      intro="Everybody this server keeps match history for. Anybody signed in can find a tracked account and read its games; only whoever claimed one can type its LP."
    >
      <TrackedAccountsCard accounts={accounts} onAdd={onAddAccount} />
      <LinkedAccountsCard accounts={accounts} onUnlink={onUnlink} />
    </SettingsPage>
  )
}

/**
 * Starting to track somebody nobody here has claimed.
 *
 * The one place an admin is deliberately special-cased. Everywhere else on this
 * server an admin is an ordinary member with powers over people and access
 * rather than over other people's data — but this spends the community's Riot
 * key on somebody who has not asked to be here and grows the database by
 * however many games they have played, which is a decision about the server.
 *
 * The account arrives unclaimed, the same state an imported one is in, and
 * whoever it really belongs to can still claim it the ordinary way. A backfill
 * starts immediately: an account added and then left empty until somebody
 * thought to press refresh would read as one that did not work.
 */
function TrackedAccountsCard({
  accounts,
  onAdd
}: {
  accounts: Account[] | undefined
  onAdd: (input: RiotIdInput) => Promise<Account>
}): JSX.Element {
  const [example] = useState(randomExampleRiotId)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const parsed = parseRiotId(value)
  const tracked = accounts?.length ?? 0

  const submit = (): void => {
    if (!parsed) {
      setError(`A Riot ID is a name and a tag, like ${example}.`)
      return
    }

    setBusy(true)
    setError(null)
    setAdded(null)

    onAdd(parsed)
      .then((account) => {
        setAdded(formatRiotId(account.gameName, account.tagLine))
        setValue('')
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  return (
    <SettingsCard
      title="Tracked League accounts"
      description={
        'Anybody on this server can find a tracked account and read its history — every game, and '
        + 'what each one was worth on the ladder. Adding one does not claim it for anybody: it arrives '
        + 'unclaimed, and whoever it belongs to can still link it from the desktop.'
      }
    >
      <SettingsBlock
        label="Add an account"
        description={
          'Resolved through Riot as it is saved, so a Riot ID that does not exist is refused rather '
          + 'than filed. The backfill starts straight away and runs at the lowest priority, behind '
          + 'anything somebody is waiting on.'
        }
      >
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
        >
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              setError(null)
            }}
            placeholder={example}
            spellCheck={false}
            aria-label="Riot ID"
            className={clsx(inputClass, 'flex-1')}
          />
          <button type="submit" className={primaryButtonClass} disabled={busy || value.trim().length === 0}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>

        {error !== null && <p className="mt-2 text-2xs text-red">{error}</p>}
        {added !== null && (
          <p className="mt-2 text-2xs text-text-mute">
            Now tracking <span className="text-text">{added}</span>. Its history is being fetched.
          </p>
        )}
      </SettingsBlock>

      <SettingsRow
        label="Accounts tracked"
        description="Everything this server keeps history for, claimed or not."
        control={
          <span className="text-sm tabular-nums text-text-dim">
            {accounts === undefined ? '—' : tracked}
          </span>
        }
      />
    </SettingsCard>
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
