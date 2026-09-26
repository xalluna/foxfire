import { useQuery } from '@tanstack/react-query'
import type { EmailConfirmation, InvitePreview, PasswordResetPreview, VersionInfo } from '@foxfire/core'
import { getVersionInfo } from '@foxfire/core/server'
import { session } from './session/session'

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
    })
}

/** For the design harness only. */
export function replaceServerInfoSource(replacement: ServerInfoSource): void {
  source = replacement
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
