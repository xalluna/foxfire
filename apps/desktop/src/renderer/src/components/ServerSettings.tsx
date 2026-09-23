import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { InvitePreview, ServerProbe, ServerState } from '@shared/types'
import { LinkAccountRow } from './LinkAccountRow'
import {
  SettingsCard,
  SettingsPage,
  ChangeEmailCard,
  ChangePasswordCard,
  ChangeUsernameCard,
  DangerRow,
  SettingsBlock,
  SettingsRow,
  StatusRow,
  ghostButtonClass,
  inputClass,
  primaryButtonClass,
  Icon
} from '@foxfire/ui'
import { MINIMUM_PASSWORD, passwordProblem } from '@foxfire/core/server'

/** Which half of the connect form is showing. */
type Mode = 'login' | 'register'

/**
 * Joining a Foxfire server, and choosing which one answers.
 *
 * The page has two shapes rather than one with everything disabled. Connected,
 * it is a short status page: who you are, where, and how to leave. Disconnected,
 * it is a connect form — an address, then what that server said about itself,
 * then credentials. Nothing about registering is shown until a server has been
 * asked whether registration is even open, because the answer decides whether
 * an invite code is required and there is no honest way to draw the form
 * before knowing.
 *
 * Local-only is a first-class state here, not an error. It is the app as it has
 * always been, and somebody who never wants a server should find this page says
 * so plainly rather than nagging.
 */
export function ServerSettings(): JSX.Element {
  const [state, setState] = useState<ServerState | null>(null)

  useEffect(() => {
    void window.api.server.getState().then(setState)
    return window.api.server.onChanged(setState)
  }, [])

  if (!state) {
    return <SettingsPage title="Server">{null}</SettingsPage>
  }

  return state.activeUrl && state.session ? (
    <ConnectedPage state={state} />
  ) : (
    <ConnectPage state={state} />
  )
}

/* -------------------------------------------------------------------------- */

function ConnectedPage({ state }: { state: ServerState }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const session = state.session!
  const active = state.servers.find((s) => s.url === state.activeUrl)

  return (
    <SettingsPage
      title="Server"
      intro={
        <>
          Foxfire is reading from {active?.name ?? state.activeUrl}. Match history, rank and LP
          come from there and are shared with everybody on it. Recordings, Riot replays and the
          League client connection stay on this PC.
        </>
      }
    >
      {state.upgradeRequired !== null && (
        <SettingsCard>
          <StatusRow tone="error">
            This server needs Foxfire {state.upgradeRequired}. Until this copy is updated it will
            not serve anything — download the new version from the releases page.
          </StatusRow>
        </SettingsCard>
      )}

      {state.serverOutdated && (
        <SettingsCard>
          <StatusRow tone="error">
            This server is running an older Foxfire Server that does not know this version of
            Foxfire, so it will not serve anything until it is updated. Ask whoever runs it to
            update the server.
          </StatusRow>
        </SettingsCard>
      )}

      <SettingsCard title="Signed in">
        <SettingsRow
          label={session.username}
          description={session.email || undefined}
          control={
            session.isAdmin ? (
              <span className="rounded border border-accent-dim/40 bg-accent/10 px-2 py-0.5 text-2xs text-accent">
                Administrator
              </span>
            ) : undefined
          }
        />
        <SettingsRow label="Address" control={<Address url={state.activeUrl!} />} />
      </SettingsCard>

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

      <SettingsCard
        title="Where Foxfire reads from"
        description="Switching to this PC does not sign you out — come back and you will not have to type a password again."
      >
        <SettingsRow
          label="This PC only"
          description="Your own database and your own Riot API key, the way Foxfire worked before servers."
          control={
            <button
              type="button"
              disabled={busy}
              className={ghostButtonClass}
              onClick={() => {
                setBusy(true)
                void window.api.server.setActive(null).finally(() => setBusy(false))
              }}
            >
              Use this PC
            </button>
          }
        />
      </SettingsCard>

      <SettingsCard>
        <DangerRow
          label="Sign out"
          description="Forgets this server's credentials on this PC. Nothing on the server is deleted."
          action="Sign out"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void window.api.server.logout().finally(() => setBusy(false))
          }}
        />
      </SettingsCard>
    </SettingsPage>
  )
}

/* -------------------------------------------------------------------------- */

function ConnectPage({ state }: { state: ServerState }): JSX.Element {
  const [url, setUrl] = useState('')
  const [probe, setProbe] = useState<ServerProbe | null>(null)
  const [probing, setProbing] = useState(false)
  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [invite, setInvite] = useState('')
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null)

  // Neither kind of refusal gets a form: the server would turn away whatever
  // was typed into it.
  const connected =
    probe?.reachable === true &&
    probe.compatibility !== 'unsupported' &&
    probe.compatibility !== 'server-outdated'
  const needsInvite = mode === 'register' && probe?.publicSignup === false

  async function check(): Promise<void> {
    setProbing(true)
    setError(null)
    setInvitePreview(null)
    try {
      const result = await window.api.server.probe(url)
      setProbe(result)
      // A server with signup shut can only be joined with an invite, so the
      // form opens on the half that can actually succeed.
      if (result.publicSignup === false) setMode('login')
    } finally {
      setProbing(false)
    }
  }

  async function checkInvite(value: string): Promise<void> {
    setInvite(value)
    setInvitePreview(null)
    if (!value.trim() || !probe?.url) return

    const preview = await window.api.server.previewInvite(probe.url, value)
    setInvitePreview(preview)
    // The invite names the address it was sent to, and registering with any
    // other one is refused. Filling it in is the difference between working
    // and a rejection nobody can explain.
    if (preview.usable && preview.email) setEmail(preview.email)
  }

  async function submit(): Promise<void> {
    if (!probe?.url) return

    // Only when registering: signing in with a typo is one wrong password, and
    // a confirmation box on that form would be asking somebody to type a
    // password they already know twice.
    if (mode === 'register') {
      const problem = passwordProblem(password, confirmation)
      if (problem !== null) {
        setError(problem)
        return
      }
    }

    setBusy(true)
    setError(null)

    try {
      const result =
        mode === 'register'
          ? await window.api.server.register(probe.url, {
              username,
              email,
              password,
              inviteToken: invite.trim() || undefined
            })
          : await window.api.server.login(probe.url, { email, password })

      if (!result.ok) setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title="Server"
      intro={
        <>
          Foxfire can read from a server your community hosts, so match history, rank and LP are
          shared rather than kept per machine. Anyone can run one — it is not a service Foxfire
          operates. Recordings, Riot replays and the League client connection always stay on this
          PC.
        </>
      }
    >
      {state.servers.length > 0 && (
        <SettingsCard
          title="Servers you have joined"
          description="Signed out of all of them. Connect again below."
        >
          {state.servers.map((server) => (
            <SettingsRow
              key={server.url}
              label={server.name}
              description={server.url}
              control={
                <>
                  <button
                    type="button"
                    className={ghostButtonClass}
                    onClick={() => {
                      setUrl(server.url)
                      setProbe(null)
                    }}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className={ghostButtonClass}
                    onClick={() => void window.api.server.forget(server.url)}
                  >
                    Forget
                  </button>
                </>
              }
            />
          ))}
        </SettingsCard>
      )}

      <SettingsCard title="Connect">
        <SettingsBlock
          label="Server address"
          description="The address whoever runs it gave you. Foxfire only uses https, unless the server is on this machine."
        >
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value)
                setProbe(null)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && url.trim()) void check()
              }}
              placeholder="foxfire.example.com"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className={clsx(inputClass, 'flex-1')}
            />
            <button
              type="button"
              disabled={!url.trim() || probing}
              className={ghostButtonClass}
              onClick={() => void check()}
            >
              {probing ? 'Checking…' : 'Check'}
            </button>
          </div>
        </SettingsBlock>

        {probe !== null && !probe.reachable && <StatusRow tone="error">{probe.error}</StatusRow>}

        {probe?.reachable === true && probe.compatibility === 'unsupported' && (
          <StatusRow tone="error">
            {probe.serverName} needs Foxfire {probe.recommendedDesktop}. This copy is too old for
            it — update Foxfire and try again.
          </StatusRow>
        )}

        {probe?.reachable === true && probe.compatibility === 'server-outdated' && (
          <StatusRow tone="error">
            {probe.serverName} is running Foxfire Server {probe.serverVersion}, which is older than
            this copy of Foxfire and does not know it. Ask whoever runs it to update the server.
          </StatusRow>
        )}

        {probe?.reachable === true && probe.compatibility === 'outdated' && (
          <StatusRow tone="warn">
            {probe.serverName} is running Foxfire Server {probe.serverVersion} and would rather
            talk to Foxfire {probe.recommendedDesktop}. This copy still works.
          </StatusRow>
        )}

        {connected && (
          <StatusRow tone="good">
            {probe.serverName} — Foxfire Server {probe.serverVersion}.{' '}
            {probe.publicSignup === true
              ? 'Anyone can make an account here.'
              : 'You need an invite to make an account here.'}
          </StatusRow>
        )}
      </SettingsCard>

      {connected && (
        <SettingsCard title={mode === 'register' ? 'Make an account' : 'Sign in'}>
          <SettingsRow
            label={mode === 'register' ? 'Already have an account?' : 'New here?'}
            control={
              <button
                type="button"
                className={ghostButtonClass}
                onClick={() => {
                  setMode(mode === 'register' ? 'login' : 'register')
                  setError(null)
                }}
              >
                {mode === 'register' ? 'Sign in instead' : 'Make an account'}
              </button>
            }
          />

          {needsInvite && (
            <SettingsBlock
              label="Invite code"
              description="Paste the code you were sent, or the whole link — either works."
            >
              <input
                value={invite}
                onChange={(e) => void checkInvite(e.target.value)}
                placeholder="Paste your invite"
                spellCheck={false}
                className={clsx(inputClass, 'w-full')}
              />
              {invitePreview !== null && (
                <p
                  className={clsx(
                    'mt-2 text-2xs leading-relaxed',
                    invitePreview.usable ? 'text-teal' : 'text-red'
                  )}
                >
                  {invitePreview.message}
                </p>
              )}
            </SettingsBlock>
          )}

          {mode === 'register' && (
            <SettingsBlock
              label="Username"
              description="What everybody else sees next to your games. Not what you sign in with."
            >
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Faker"
                className={clsx(inputClass, 'w-full')}
              />
            </SettingsBlock>
          )}

          <SettingsBlock label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              spellCheck={false}
              autoCapitalize="off"
              className={clsx(inputClass, 'w-full')}
            />
          </SettingsBlock>

          <SettingsBlock
            label="Password"
            description={
              mode === 'register' ? `At least ${MINIMUM_PASSWORD} characters.` : undefined
            }
          >
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit()
              }}
              className={clsx(inputClass, 'w-full')}
            />
          </SettingsBlock>

          {mode === 'register' && (
            <SettingsBlock
              label="Confirm password"
              description="Typed twice because a password nobody can read is a password nobody can check."
            >
              <input
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
                className={clsx(inputClass, 'w-full')}
              />
            </SettingsBlock>
          )}

          {mode === 'login' && (
            <SettingsBlock>
              {/* No self-service reset: a Foxfire server sends no mail, so
                  there is nowhere to send a link except through its admin. */}
              <p className="text-2xs leading-relaxed text-text-mute">
                Forgotten your password? Ask whoever runs this server for a reset link, and open it
                in a browser.
              </p>
            </SettingsBlock>
          )}

          {error !== null && <StatusRow tone="error">{error}</StatusRow>}

          <div className="flex justify-end px-4 py-3">
            <button
              type="button"
              disabled={
                busy ||
                !email.trim() ||
                !password ||
                (mode === 'register' && (!username.trim() || !confirmation))
              }
              className={primaryButtonClass}
              onClick={() => void submit()}
            >
              {busy ? 'Connecting…' : mode === 'register' ? 'Make an account' : 'Sign in'}
            </button>
          </div>
        </SettingsCard>
      )}

      <SettingsCard title="Running your own">
        <SettingsRow
          label="Foxfire Server"
          description="Docker Compose, a Riot API key and about ten minutes. There is no central Foxfire service — every community runs their own."
          control={<span className="text-2xs text-text-mute">See apps/server in the repo</span>}
        />
      </SettingsCard>
    </SettingsPage>
  )
}

/** The address, small and selectable, with nothing pretending to be a link. */
function Address({ url }: { url: string }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5 text-2xs text-text-mute">
      <Icon.Server width={12} height={12} />
      <code className="select-text">{url}</code>
    </span>
  )
}
