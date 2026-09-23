import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { EmailChange, PasswordChange } from '@foxfire/core'
import { passwordProblem, MINIMUM_PASSWORD } from '@foxfire/core/server'
import { SettingsCard } from '../components/settings/SettingsCard'
import { SettingsBlock, StatusRow } from '../components/settings/SettingsRow'
import { inputClass, primaryButtonClass } from '../components/settings/controls'

/**
 * What a save answered with.
 *
 * A result rather than a thrown error, the way every administrative write on
 * this server already answers: the reason a change was refused — the wrong
 * current password, an address somebody else has — is the most useful thing on
 * the screen, and it belongs under the form rather than in a stack trace.
 */
export interface AccountSaveResult {
  ok: boolean
  error: string | null
}

/**
 * The three things somebody can change about their own account.
 *
 * Cards rather than a page, because the two clients put them in different
 * places: the web client has an Account page of its own, and the desktop shows
 * them under the server it is signed in to, beside the address and the League
 * accounts. Both get the same forms and the same sentences.
 */
export function ChangeUsernameCard({
  username,
  onSave
}: {
  username: string
  onSave: (username: string) => Promise<AccountSaveResult>
}): JSX.Element {
  const [value, setValue] = useState(username)
  const save = useSave()

  const unchanged = value.trim() === username

  return (
    <SettingsCard title="Name">
      <SettingsBlock
        label="Username"
        description="What everybody here sees beside your games. Not what you sign in with."
      >
        <div className="flex gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            minLength={3}
            maxLength={32}
            autoComplete="username"
            aria-label="Username"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={save.busy || unchanged || value.trim().length < 3}
            className={primaryButtonClass}
            onClick={() => void save.run(() => onSave(value.trim()), 'Saved.')}
          >
            {save.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </SettingsBlock>

      <Outcome outcome={save.outcome} />
    </SettingsCard>
  )
}

/**
 * Changing the address you sign in with.
 *
 * One address this refuses to move is the one a server's configuration names as
 * its administrator, and that refusal comes from the server: Admin__Email is
 * configuration, so no client can see it, and a card that guessed would either
 * be wrong or need the server to publish it.
 */
export function ChangeEmailCard({
  email,
  onSave
}: {
  email: string
  onSave: (change: EmailChange) => Promise<AccountSaveResult>
}): JSX.Element {
  const [value, setValue] = useState(email)
  const [password, setPassword] = useState('')
  const save = useSave()

  return (
    <SettingsCard title="Email">
      <SettingsBlock label="Email" description="What you sign in with.">
        <input
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="email"
          aria-label="Email"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      <SettingsBlock
        label="Current password"
        description="Asked for because a session is not proof of the person: somebody at an unlocked browser has one."
      >
        <div className="flex gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="Current password"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={save.busy || !password || !value.trim() || value.trim() === email}
            className={primaryButtonClass}
            onClick={() =>
              void save.run(
                () => onSave({ email: value.trim(), currentPassword: password }),
                'Saved. Sign in with the new address from now on.',
                () => setPassword('')
              )
            }
          >
            {save.busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </SettingsBlock>

      <Outcome outcome={save.outcome} />
    </SettingsCard>
  )
}

export function ChangePasswordCard({
  onSave
}: {
  onSave: (change: PasswordChange) => Promise<AccountSaveResult>
}): JSX.Element {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const save = useSave()

  function submit(): void {
    const problem = passwordProblem(next, confirmation)
    if (problem !== null) {
      save.fail(problem)
      return
    }

    void save.run(
      () => onSave({ currentPassword: current, newPassword: next }),
      'Saved. Every other device has been signed out.',
      () => {
        setCurrent('')
        setNext('')
        setConfirmation('')
      }
    )
  }

  return (
    <SettingsCard
      title="Password"
      description="Changing it signs out every other device — this one stays signed in. If the old password had got out, nothing minted from it survives."
    >
      <SettingsBlock label="Current password">
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          aria-label="Current password"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      <SettingsBlock label="New password" description={`At least ${MINIMUM_PASSWORD} characters.`}>
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          aria-label="New password"
          className={clsx(inputClass, 'w-full')}
        />
      </SettingsBlock>

      <SettingsBlock label="Confirm new password">
        <div className="flex gap-2">
          <input
            type="password"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            autoComplete="new-password"
            aria-label="Confirm new password"
            className={clsx(inputClass, 'flex-1')}
          />
          <button
            type="button"
            disabled={save.busy || !current || !next || !confirmation}
            className={primaryButtonClass}
            onClick={submit}
          >
            {save.busy ? 'Saving…' : 'Change password'}
          </button>
        </div>
      </SettingsBlock>

      <Outcome outcome={save.outcome} />
    </SettingsCard>
  )
}

/* -------------------------------------------------------------------------- */

interface Outcome {
  tone: 'good' | 'error'
  message: string
}

/** The half of each card that is the same: busy, what happened, and saying so. */
function useSave(): {
  busy: boolean
  outcome: Outcome | null
  run: (save: () => Promise<AccountSaveResult>, done: string, onDone?: () => void) => Promise<void>
  fail: (message: string) => void
} {
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  return {
    busy,
    outcome,
    fail: (message) => setOutcome({ tone: 'error', message }),
    async run(save, done, onDone) {
      setBusy(true)
      setOutcome(null)

      try {
        const result = await save()

        if (result.ok) {
          setOutcome({ tone: 'good', message: done })
          onDone?.()
        } else {
          setOutcome({ tone: 'error', message: result.error ?? 'That could not be saved.' })
        }
      } catch (err: unknown) {
        setOutcome({ tone: 'error', message: err instanceof Error ? err.message : String(err) })
      } finally {
        setBusy(false)
      }
    }
  }
}

function Outcome({ outcome }: { outcome: Outcome | null }): ReactNode {
  if (outcome === null) return null
  return <StatusRow tone={outcome.tone}>{outcome.message}</StatusRow>
}
