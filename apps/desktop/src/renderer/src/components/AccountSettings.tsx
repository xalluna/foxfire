import {
  ChangeEmailCard,
  ChangePasswordCard,
  ChangeUsernameCard,
  SettingsCard,
  SettingsPage
} from '@foxfire/ui'
import { useConnection } from '@foxfire/screens'
import { LinkAccountRow } from './LinkAccountRow'

/**
 * Your own account, on the server this PC is signed in to.
 *
 * Its own page rather than more of Server's. Server is about the connection —
 * which one answers, and how to leave it — and every card here is about the
 * person instead: the name everybody sees, how you sign in, and which League
 * accounts are yours. Together they made Server the longest page in Settings
 * for somebody who only wanted to check where Foxfire was reading from.
 *
 * Only offered while signed in; local-only, there is no account to look after.
 */
export function AccountSettings(): JSX.Element {
  const connection = useConnection()
  const session = connection?.mode === 'server' ? connection.session : null

  if (!session) {
    return <SettingsPage title="Account">{null}</SettingsPage>
  }

  return (
    <SettingsPage
      title="Account"
      intro={
        <>
          Your account on {connection?.serverName ?? 'this server'}: the name everybody here sees
          beside your games, how you sign in, and the League accounts that are yours.
        </>
      }
    >
      <ChangeUsernameCard
        username={session.username}
        onSave={(username) => window.api.server.changeUsername(username)}
      />

      <ChangeEmailCard email={session.email} onSave={(change) => window.api.server.changeEmail(change)} />

      <ChangePasswordCard onSave={(change) => window.api.server.changePassword(change)} />

      <SettingsCard
        title="Your League accounts"
        description="A server links the account it can see you are signed in to, rather than one you type — which is what stops anybody claiming a Riot ID that is not theirs."
      >
        <LinkAccountRow />
      </SettingsCard>
    </SettingsPage>
  )
}
