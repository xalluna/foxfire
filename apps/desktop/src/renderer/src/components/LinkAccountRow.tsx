import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Account, LcuStatus } from '@shared/types'
import { SettingsRow, primaryButtonClass } from '@foxfire/ui'

/**
 * Claiming the League account this machine is signed in to.
 *
 * The only way an account becomes yours on a server, and until now there was no
 * way at all: the typed-Riot-ID form refuses on purpose — a name in a box
 * attests to nothing — and the watcher only ever looked accounts up. So an
 * account could sit on a server carrying a year of somebody's history and
 * belong to nobody, which is exactly what an imported stats.db produces.
 *
 * What makes the claim mean something is where the Riot ID comes from: a
 * League client running on this machine, signed in. That is what the button is
 * waiting for, and why it says which account it can see rather than asking.
 *
 * First claim wins and there is no undo from here — an admin unlinks. Hence a
 * button rather than doing it the moment the client appears: on a shared PC,
 * or a smurf somebody else is meant to have, silently taking it would be the
 * wrong default and the only remedy would be asking an admin.
 */
export function LinkAccountRow(): JSX.Element | null {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<LcuStatus>({ state: 'disconnected' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.api.lcu.getStatus().then(setStatus)
    return window.api.lcu.onStatus(setStatus)
  }, [])

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => window.api.accounts.list()
  })

  if (status.state === 'disconnected') {
    return (
      <SettingsRow
        label="Link a League account"
        description="Start the League client and sign in to the account you want to claim. Foxfire links the one it can see, which is what makes the claim mean anything."
      />
    )
  }

  const riotId = `${status.gameName}#${status.tagLine}`
  const known = matching(accounts.data, status.gameName, status.tagLine)

  // Already yours. Said rather than hidden, because "did that work?" is the
  // question somebody has right after pressing the button.
  if (known?.isMine === true) {
    return (
      <SettingsRow
        label={riotId}
        description="Linked to you. Its games and rank are yours to edit."
        control={<span className="text-2xs text-good">Linked</span>}
      />
    )
  }

  // Somebody else got there first. Nothing this screen can do about it — the
  // whole point of first-claim-wins is that an admin is the escape hatch.
  if (known?.ownerUsername != null && known.isMine === false) {
    return (
      <SettingsRow
        label={riotId}
        description={`Claimed by ${known.ownerUsername}. An administrator can unlink it.`}
      />
    )
  }

  return (
    <SettingsRow
      label={riotId}
      description={
        error ??
        'Signed in to the League client on this PC, and not claimed by anybody on this server yet.'
      }
      control={
        <button
          type="button"
          disabled={busy}
          className={primaryButtonClass}
          onClick={() => {
            setBusy(true)
            setError(null)

            window.api.accounts
              .link({ gameName: status.gameName, tagLine: status.tagLine })
              .then(() => {
                // The rail, the dashboard and this row all read the same list.
                void queryClient.invalidateQueries({ queryKey: ['accounts'] })
              })
              .catch((err: Error) => setError(err.message))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Linking…' : `Link ${riotId}`}
        </button>
      }
    />
  )
}

/** The stored account for a Riot ID, if this server has one. Riot IDs are not case-sensitive. */
function matching(accounts: Account[] | undefined, gameName: string, tagLine: string): Account | undefined {
  const wanted = `${gameName}#${tagLine}`.toLowerCase()
  return accounts?.find((a) => `${a.gameName}#${a.tagLine}`.toLowerCase() === wanted)
}
