import type { AdminUser } from '@foxfire/core'

/**
 * Everybody whose name or address contains what was typed.
 *
 * Client-side, because the server hands over the whole list in one call and a
 * community that fills a page of it is a large one. Name and address both,
 * since an admin looking somebody up has whichever of the two they were given
 * — a Discord handle usually matches the username, a mail forward the address.
 */
export function filterMembers(users: AdminUser[], query: string): AdminUser[] {
  const needle = (query ?? '').trim().toLowerCase()
  if (!needle) return users

  return users.filter(
    (user) =>
      user.username.toLowerCase().includes(needle) || user.email.toLowerCase().includes(needle)
  )
}
