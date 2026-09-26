import { useState } from 'react'
import clsx from 'clsx'
import type { Account, AdminActionResult, RiotIdInput } from '@foxfire/core'
import { SettingsCard, SettingsPage } from '../components/settings/SettingsCard'
import { SettingsBlock, SettingsRow, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, inputClass, primaryButtonClass } from '../components/settings/controls'
import { parseRiotId, formatRiotId } from '../lib/riotId'
import { randomExampleRiotId } from '../lib/exampleRiotId'
import { EmptyState } from '../components/EmptyState'
import { ShowMoreButton } from '../components/ShowMore'
import * as Icon from '../components/icons'
import { useRowAction } from './rowAction'

export interface LeagueAccountsPageProps {
  /** How many League accounts the server tracks, claimed or not. Undefined while it loads. */
  tracked: number | undefined

  /** The pages of claimed accounts fetched so far, matching `claimedQuery`. Undefined while they load. */
  claimed: Account[] | undefined
  /** What the list of claims is filtered to — a name, a tag or a whole Riot ID. */
  claimedQuery: string
  onClaimedQueryChange: (query: string) => void
  /** Whether there is another page of claims after `claimed`. */
  hasMoreClaimed: boolean
  loadingMoreClaimed: boolean
  onShowMoreClaimed: () => void

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
  tracked,
  claimed,
  claimedQuery,
  onClaimedQueryChange,
  hasMoreClaimed,
  loadingMoreClaimed,
  onShowMoreClaimed,
  onAddAccount,
  onUnlink
}: LeagueAccountsPageProps): JSX.Element {
  return (
    <SettingsPage
      title="League accounts"
      intro="Everybody this server keeps match history for. Anybody signed in can find a tracked account and read its games; only whoever claimed one, or a head admin, can type its LP."
    >
      <TrackedAccountsCard tracked={tracked} onAdd={onAddAccount} />
      <LinkedAccountsCard
        claimed={claimed}
        query={claimedQuery}
        onQueryChange={onClaimedQueryChange}
        hasMore={hasMoreClaimed}
        loadingMore={loadingMoreClaimed}
        onShowMore={onShowMoreClaimed}
        onUnlink={onUnlink}
      />
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
  tracked,
  onAdd
}: {
  tracked: number | undefined
  onAdd: (input: RiotIdInput) => Promise<Account>
}): JSX.Element {
  const [example] = useState(randomExampleRiotId)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string | null>(null)

  const parsed = parseRiotId(value)

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
            {tracked === undefined ? '—' : tracked}
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
  claimed,
  query,
  onQueryChange,
  hasMore,
  loadingMore,
  onShowMore,
  onUnlink
}: {
  claimed: Account[] | undefined
  query: string
  onQueryChange: (query: string) => void
  hasMore: boolean
  loadingMore: boolean
  onShowMore: () => void
  onUnlink: (accountId: string) => Promise<AdminActionResult>
}): JSX.Element {
  const unlink = useRowAction(onUnlink)
  const typed = query.trim()

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

      {/* A page at a time, so an admin looking for one claim among many
          finds it by name rather than by scrolling. */}
      <SettingsBlock>
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Find a claimed account by name or Riot ID"
          spellCheck={false}
          aria-label="Find a claimed account"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      {claimed !== undefined && claimed.length === 0 && (
        typed.length > 0 ? (
          <EmptyState
            icon={<Icon.Search />}
            title="No claimed account by that name"
            description={`Nobody has claimed an account matching ${typed}. It may be tracked and unclaimed — the search box at the top finds those too.`}
          />
        ) : (
          <EmptyState
            icon={<Icon.Server />}
            title="Nobody has claimed an account yet"
            description="Members claim their own by signing in to the League client with Foxfire connected."
          />
        )
      )}

      {claimed?.map((account) => (
        <LinkedAccountRow
          key={account.id}
          account={account}
          onUnlink={() => unlink.start(account.id)}
          unlinking={unlink.pendingId === account.id}
        />
      ))}

      {hasMore && <ShowMoreButton variant="settings" onClick={onShowMore} loading={loadingMore} />}
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
