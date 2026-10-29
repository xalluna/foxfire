import { useQuery } from '@tanstack/react-query'
import type {
  EmailConfirmation,
  InvitePreview,
  PasswordResetPreview,
  ShareLinkOpen,
  VersionInfo
} from '@foxfire/core'
import { getVersionInfo } from '@foxfire/core/server'
import { session, useAuth } from './session/session'
import { LAPSED, grantFrom, hasLapsed, rememberShare, rememberedShare } from './session/share'

/**
 * What the server says before anybody signs in: its name, and whether it takes
 * registrations. Replaced in the design harness, which has no server.
 */
export interface ServerInfoSource {
  version(): Promise<VersionInfo>
  previewInvite(token: string): Promise<InvitePreview>
  previewPasswordReset(token: string): Promise<PasswordResetPreview>
  /** "Forgot password?" — the same answer whatever the address, by design. */
  requestPasswordReset(email: string): Promise<{ message: string }>
  /** Opens a confirmation link. The token goes in the body, never the path. */
  confirmEmail(token: string): Promise<EmailConfirmation>
  /** Says whose profile a share link opens, or why it opens nothing. The token in the body again. */
  openShare(token: string): Promise<ShareLinkOpen>
}

let source: ServerInfoSource = {
  version: () => getVersionInfo(session.transport),
  previewInvite: (token) =>
    session.transport.request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}/preview`),
  previewPasswordReset: (token) =>
    session.transport.request<PasswordResetPreview>(
      `/api/password-resets/${encodeURIComponent(token)}/preview`
    ),
  requestPasswordReset: (email) =>
    session.transport.request<{ message: string }>('/api/password-resets/request', {
      method: 'POST',
      body: { email }
    }),
  confirmEmail: (token) =>
    session.transport.request<EmailConfirmation>('/api/email-verifications/confirm', {
      method: 'POST',
      body: { token }
    }),
  openShare: (token) =>
    session.transport.request<ShareLinkOpen>('/api/shares/open', { method: 'POST', body: { token } })
}

/** For the design harness only. */
export function replaceServerInfoSource(replacement: ServerInfoSource): void {
  source = replacement
}

/**
 * What somebody who is not signed in may read, settled before the first page
 * renders — so the router can tell a visitor it may let in from one to send to
 * the sign-in page.
 *
 * Whether the server is open comes from its handshake. A share link is opened
 * here, once, when the page was loaded with one; otherwise the one this tab
 * was opened with earlier is picked back up — and if it has run out since,
 * that is what the page says. A member signed in needs neither, and their
 * tab's remembered link is left for whenever they sign out.
 */
export async function prepareAccess(shareToken: string | null): Promise<void> {
  const version = await source.version().catch(() => null)
  const publicAccess = version?.publicAccess ?? false

  if (useAuth.getState().user !== null) {
    useAuth.setState({ publicAccess })
    return
  }

  if (shareToken === null) {
    const kept = rememberedShare()

    if (kept && hasLapsed(kept)) {
      rememberShare(null)
      useAuth.setState({ publicAccess, share: null, shareRefused: LAPSED })
    } else {
      useAuth.setState({ publicAccess, share: kept, shareRefused: null })
    }
    return
  }

  try {
    const opened = await source.openShare(shareToken)
    const share = grantFrom(shareToken, opened)
    rememberShare(share)
    useAuth.setState({
      publicAccess,
      share,
      shareRefused: share ? null : { reason: opened.reason ?? 'invalid', message: opened.message }
    })
  } catch (err) {
    useAuth.setState({
      publicAccess,
      share: null,
      shareRefused: { reason: 'unreachable', message: describeError(err) }
    })
  }
}

/** The server's handshake, read once per page load. */
export function useServerInfo() {
  return useQuery({
    queryKey: ['server-info'],
    queryFn: () => source.version(),
    staleTime: Infinity
  })
}

/** What an invite link's token is good for, without spending it. */
export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => source.previewInvite(token),
    retry: false
  })
}

/** Whose account a reset link sets, and whether it is still good for it. */
export function usePasswordResetPreview(token: string) {
  return useQuery({
    queryKey: ['password-reset-preview', token],
    queryFn: () => source.previewPasswordReset(token),
    retry: false
  })
}

/** Asks for a reset link by email. */
export function requestPasswordReset(email: string): Promise<{ message: string }> {
  return source.requestPasswordReset(email)
}

/** Opens a confirmation link — once, which is why this is not a query. */
export function confirmEmail(token: string): Promise<EmailConfirmation> {
  return source.confirmEmail(token)
}

/** A failure, in words a person can read — the server's own, wherever it wrote some. */
export function describeError(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Try again.'
}
