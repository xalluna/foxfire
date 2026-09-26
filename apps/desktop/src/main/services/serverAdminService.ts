import { serverApi } from './serverService'
import type {
  Account,
  AdminActionResult,
  AdminReplay,
  AdminInvite,
  AdminPasswordReset,
  AdminUser,
  AdminUserPatch,
  AdminUserQuery,
  Page,
  PageOptions,
  RiotIdInput,
  ServerAdminSettings,
  ServerStorageUsage
} from '@shared/types'

/**
 * Administering the active server, from the desktop.
 *
 * Every call here goes through the active server's session, so the access
 * token, its renewal and the version gate are somebody else's problem — and the
 * routes and shapes are @foxfire/core's, which the web client's admin pages
 * read through too. What is left is the names the IPC handlers call.
 *
 * Reads throw and writes return a result — see createServerApi for why, and
 * for why nothing here checks that the caller is an admin.
 */

export async function getStorageUsage(): Promise<ServerStorageUsage> {
  return serverApi().admin.storage()
}

export async function listStoredReplays(page?: PageOptions): Promise<Page<AdminReplay>> {
  return serverApi().admin.storedReplays(page)
}

export async function removeStoredReplay(matchId: string): Promise<AdminActionResult> {
  return serverApi().admin.removeReplay(matchId)
}

/** Takes a League account away from whoever claimed it. The games stay. */
export async function forceUnlink(riotAccountId: string): Promise<AdminActionResult> {
  return serverApi().admin.forceUnlink(riotAccountId)
}

/** Starts tracking an account nobody on the server has claimed, and backfills it. */
export async function addRiotAccount(input: RiotIdInput): Promise<Account> {
  return serverApi().admin.addRiotAccount(input)
}

export async function listUsers(query?: AdminUserQuery): Promise<Page<AdminUser>> {
  return serverApi().admin.users(query)
}

export async function updateUser(id: string, patch: AdminUserPatch): Promise<AdminActionResult> {
  return serverApi().admin.updateUser(id, patch)
}

export async function deleteUser(id: string): Promise<AdminActionResult> {
  return serverApi().admin.deleteUser(id)
}

/** Makes a reset link for somebody, replacing whatever was outstanding for them. */
export async function createPasswordReset(userId: string): Promise<AdminPasswordReset> {
  return serverApi().admin.createPasswordReset(userId)
}

export async function revokePasswordReset(userId: string): Promise<AdminActionResult> {
  return serverApi().admin.revokePasswordReset(userId)
}

export async function listOpenInvites(): Promise<AdminInvite[]> {
  return serverApi().admin.openInvites()
}

export async function listUsedInvites(page?: PageOptions): Promise<Page<AdminInvite>> {
  return serverApi().admin.usedInvites(page)
}

export async function createInvite(email?: string): Promise<AdminInvite> {
  return serverApi().admin.createInvite(email)
}

export async function revokeInvite(id: string): Promise<AdminActionResult> {
  return serverApi().admin.revokeInvite(id)
}

export async function getSettings(): Promise<ServerAdminSettings> {
  return serverApi().admin.getSettings()
}

export async function setSettings(
  patch: Partial<ServerAdminSettings>
): Promise<ServerAdminSettings> {
  return serverApi().admin.setSettings(patch)
}
