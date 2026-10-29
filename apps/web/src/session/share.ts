import type { ShareLinkEnd, ShareLinkOpen } from '@foxfire/core'

/** One profile somebody shared with this tab, as the server described it when it was opened. */
export interface ShareGrant {
  token: string
  accountId: string
  gameName: string
  tagLine: string
  expiresAt: string
}

/**
 * Why the link this tab was opened with shows nothing — so the page can say
 * that, rather than sending somebody who was never a member to sign in.
 * `unreachable` is the server not answering, which says nothing about the link.
 */
export interface ShareRefusal {
  reason: ShareLinkEnd | 'unreachable'
  /** The server's words, where it gave some. */
  message: string
}

/** What a link that ran out while it was open says, in the server's own words for it. */
export const LAPSED: ShareRefusal = {
  reason: 'expired',
  message: 'This link has expired. Ask whoever sent it for a new one.'
}

/**
 * The refusal a read answered with, when it means the link itself stopped
 * working — `share_link_expired` and its siblings. Null for anything else,
 * such as a working link asked for a profile it does not open.
 */
export function refusalFrom(code: string | null, message: string): ShareRefusal | null {
  switch (code) {
    case 'share_link_expired':
      return { reason: 'expired', message }
    case 'share_link_withdrawn':
      return { reason: 'withdrawn', message }
    case 'share_link_invalid':
      return { reason: 'invalid', message }
    default:
      return null
  }
}

const PARAM = 'share'
const STORAGE_KEY = 'foxfire:share'

/**
 * Takes a share link's token off the address this page was opened on.
 *
 * Before the router reads the address, so no page ever sees it, and with
 * `replaceState`, so the token leaves the history entry too: what stays in the
 * address bar is the plain profile link, which is what anybody copying it
 * should get. The token itself travels in a header from here on.
 */
export function takeShareFromAddress(): string | null {
  const url = new URL(window.location.href)
  const token = url.searchParams.get(PARAM)
  if (token === null) return null

  url.searchParams.delete(PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  return token.trim() || null
}

/**
 * The link this tab was opened with, kept for as long as the tab is.
 *
 * Session storage rather than memory, so reloading the profile keeps working
 * once the token is off the address; and rather than local storage, so the
 * link stays with the tab it was opened in and is gone when that closes.
 *
 * Handed back whether or not it has lapsed since: a tab reloaded after its
 * link ran out should say so, not quietly forget it ever had one.
 */
export function rememberedShare(): ShareGrant | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as ShareGrant) : null
  } catch {
    return null
  }
}

export function hasLapsed(grant: ShareGrant, now = Date.now()): boolean {
  return !(Date.parse(grant.expiresAt) > now)
}

export function rememberShare(grant: ShareGrant | null): void {
  try {
    if (grant) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(grant))
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Not kept: the link works until this page is reloaded.
  }
}

/** What the server said about a token, as this page keeps it. */
export function grantFrom(token: string, opened: ShareLinkOpen): ShareGrant | null {
  if (!opened.usable || !opened.riotAccountId || !opened.gameName || !opened.tagLine || !opened.expiresAt) {
    return null
  }

  return {
    token,
    accountId: opened.riotAccountId,
    gameName: opened.gameName,
    tagLine: opened.tagLine,
    expiresAt: opened.expiresAt
  }
}
