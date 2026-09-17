import { authedRequest } from './serverService'
import { ServerError } from '../server/client'
import { createLogger } from '../telemetry/logger'
import type {
  AdminActionResult,
  AdminInvite,
  AdminUser,
  AdminUserPatch,
  ServerAdminSettings
} from '@shared/types'

const log = createLogger('server-admin')

/**
 * Administering the active server, from the desktop.
 *
 * Every call here goes through `authedRequest`, so the access token, its
 * renewal and the version gate are somebody else's problem — this is only the
 * routes and the shapes.
 *
 * Reads throw and writes return a result, which is a deliberate asymmetry. A
 * read that fails has nothing to show and the query layer already knows how to
 * render that. A write that fails usually failed for a reason the person needs
 * to read — the last administrator cannot be demoted, an invite that has been
 * used cannot be withdrawn — and a message they can act on is the entire point
 * of having asked.
 *
 * Nothing here is gated on the caller being an admin. The server decides that,
 * and it decides it on every request; a check here would only be a second
 * opinion that could disagree after somebody was demoted mid-session.
 */

export async function listUsers(): Promise<AdminUser[]> {
  return authedRequest<AdminUser[]>('/admin/users/')
}

export async function updateUser(id: string, patch: AdminUserPatch): Promise<AdminActionResult> {
  return attempt(() =>
    authedRequest<void>(`/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch
    })
  )
}

export async function deleteUser(id: string): Promise<AdminActionResult> {
  return attempt(() =>
    authedRequest<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })
  )
}

export async function listInvites(): Promise<AdminInvite[]> {
  return authedRequest<AdminInvite[]>('/admin/invites/')
}

/**
 * Creates an invite, or hands back the one already outstanding for that address.
 *
 * The server does the deduplicating. An admin who cannot remember whether they
 * already sent one gets the link that is in somebody's inbox rather than a
 * second one that quietly does nothing.
 */
export async function createInvite(email: string): Promise<AdminInvite> {
  return authedRequest<AdminInvite>('/admin/invites/', { method: 'POST', body: { email } })
}

export async function revokeInvite(id: string): Promise<AdminActionResult> {
  return attempt(() =>
    authedRequest<void>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' })
  )
}

export async function getSettings(): Promise<ServerAdminSettings> {
  return authedRequest<ServerAdminSettings>('/admin/settings/')
}

export async function setSettings(
  patch: Partial<ServerAdminSettings>
): Promise<ServerAdminSettings> {
  return authedRequest<ServerAdminSettings>('/admin/settings/', { method: 'PATCH', body: patch })
}

/**
 * Turns a refusal into something to show, and anything else into a log line.
 *
 * The server writes these messages and they are meant to be read, so they are
 * passed through unchanged rather than translated into a second vocabulary that
 * would drift from the first.
 */
async function attempt(run: () => Promise<unknown>): Promise<AdminActionResult> {
  try {
    await run()
    return { ok: true, error: null }
  } catch (err) {
    if (!(err instanceof ServerError)) log.error('An admin action failed', { error: String(err) })

    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    }
  }
}
