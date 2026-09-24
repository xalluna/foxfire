import {
  ChangeEmailCard,
  ChangePasswordCard,
  ChangeUsernameCard,
  SettingsCard,
  SettingsPage,
  SettingsRow
} from '@foxfire/ui'
import { useConnection } from '@foxfire/screens'
import { changeEmail, changePassword, changeUsername, useAuth } from '../session/session'

/**
 * Your own account, on the server serving this page.
 *
 * Called Account rather than Profile: a profile here is a League player's, with
 * their games and their rank on it, and this is the other thing entirely — the
 * address you sign in with and the password that opens it.
 *
 * Each card saves on its own. They are three unrelated changes, two of which
 * want your current password, and one Save button over the lot of them would
 * be asking for it to change your username.
 */
export function AccountPage(): JSX.Element {
  const user = useAuth((s) => s.user)
  const connection = useConnection()

  if (!user) return <></>

  return (
    <SettingsPage
      title="Account"
      intro={`Your account on ${connection?.serverName ?? 'this server'}. Your League accounts are linked from the desktop app, which can see which one you are signed in to.`}
    >
      <SettingsCard title="Signed in">
        <SettingsRow
          label={user.username}
          description={user.email}
          control={
            user.isAdmin ? (
              <span className="rounded border border-accent-dim/40 bg-accent/10 px-2 py-0.5 text-2xs text-accent">
                Administrator
              </span>
            ) : undefined
          }
        />
      </SettingsCard>

      <ChangeUsernameCard
        username={user.username}
        onSave={async (username) => {
          await changeUsername(username)
          return { ok: true, error: null }
        }}
      />

      <ChangeEmailCard
        email={user.email}
        onSave={async (change) => {
          await changeEmail(change)
          return { ok: true, error: null }
        }}
      />

      <ChangePasswordCard
        onSave={async (change) => {
          await changePassword(change)
          return { ok: true, error: null }
        }}
      />
    </SettingsPage>
  )
}
