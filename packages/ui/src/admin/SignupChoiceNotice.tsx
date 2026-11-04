import { useState } from 'react'
import { SettingsCard } from '../components/settings/SettingsCard'
import { SettingsBlock, StatusRow } from '../components/settings/SettingsRow'
import { ghostButtonClass, primaryButtonClass } from '../components/settings/controls'

/**
 * Asks the owner of a server that never chose who may make an account.
 *
 * Only a server from before new ones started invite-only can be in that state:
 * open, by a default nobody was told about, so anybody with its address could
 * register and read everything a member can. Either answer writes the setting,
 * and the notice goes away for good. Shown where an admin lands — Members and
 * Invites, and the desktop's Server page — rather than tucked into the switch
 * it is about.
 */
export function SignupChoiceNotice({
  onChoose
}: {
  /** True keeps sign-up open; false makes the server invite-only. */
  onChoose: (open: boolean) => Promise<void>
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = (open: boolean): void => {
    setBusy(true)
    setError(null)
    onChoose(open)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setBusy(false))
  }

  return (
    <SettingsCard title="Who can join">
      <StatusRow tone="warn">
        Anybody with this server&apos;s address can make an account, and then read everything a member
        can — including who claimed which League account. That has been so by default; nobody has
        chosen it yet.
      </StatusRow>
      <SettingsBlock>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} className={primaryButtonClass} onClick={() => choose(false)}>
            Invite only
          </button>
          <button type="button" disabled={busy} className={ghostButtonClass} onClick={() => choose(true)}>
            Keep it open
          </button>
        </div>
        {error !== null && <p className="mt-3 text-sm text-red">{error}</p>}
      </SettingsBlock>
    </SettingsCard>
  )
}
