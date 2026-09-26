/**
 * The shapes a Foxfire Server speaks in, beyond the League data itself.
 *
 * Joining, signing in, invites, and administering a server. Both clients read
 * these: the desktop from its main process, the web client from the browser.
 */

import type { PageOptions } from './domain'

/**
 * What a server said about itself when asked, before anybody typed a password.
 *
 * Answered by the one endpoint that needs no authentication and no version
 * header, which is the whole point of it: a desktop too old to be served has to
 * be able to find that out and say so. `error` is filled in and `reachable` is
 * false for every kind of not-working — wrong address, server down, a
 * certificate this machine will not trust — because all of them are things to
 * render in the connect form rather than exceptions to handle.
 */
export interface ServerProbe {
  url: string
  reachable: boolean
  error: string | null
  serverName: string | null
  serverVersion: string | null
  apiVersion: number | null
  minimumDesktop: string | null
  recommendedDesktop: string | null
  /** Whether anybody may register, or an invite is needed. */
  publicSignup: boolean | null
  /**
   * Where the server's web client is reached from outside — what "Copy link"
   * builds on. Null from a server older than the web client, and when the
   * server could not be reached.
   */
  publicUrl: string | null
  /**
   * Whether the server sends email — and so whether "Forgot password?" can be
   * offered. Null from a server older than mail, and when it could not be
   * reached.
   */
  email: boolean | null
  /**
   * How this build stands against that server's stated range. Advisory only:
   * the server's allow list is a set rather than a range, so a version between
   * the minimum and the newest can still be absent from it. This decides what
   * the connect screen says, never whether to proceed.
   *
   * `server-outdated` is this build being newer than anything the server
   * knows: it will be refused, and the remedy is the host updating the server,
   * not anybody installing the older Foxfire the server would name.
   */
  compatibility: 'ok' | 'outdated' | 'unsupported' | 'server-outdated' | 'unknown'
}

/**
 * What `GET /version` says, as a client reads it.
 *
 * The raw answer, before the desktop judges its own version against it — see
 * ServerProbe for that. `apiBase` and `publicUrl` are absent from a server
 * older than the web client.
 */
export interface VersionInfo {
  serverName: string
  serverVersion: string
  apiVersion: number
  minimumDesktop: string
  recommendedDesktop: string
  publicSignup: boolean
  /** Where the API is mounted, e.g. "/api". Absent means the root. */
  apiBase?: string
  /** The address the server is reached at from outside, which is what share links are built on. */
  publicUrl?: string
  /** Whether the server sends email. Absent from a server older than mail. */
  email?: boolean
}

/** Who you are on a server, as the server says it. */
export interface SessionUser {
  id: string
  username: string
  email: string
  isAdmin: boolean
  /**
   * An admin who may also import, type LP on anybody's account, and demote,
   * disable, remove or make a reset link for another admin. Always an admin as
   * well. Optional only because a session kept from an older server lacks it.
   */
  isHeadAdmin?: boolean
  /** Whether they have shown they read mail sent to `email`. */
  emailConfirmed?: boolean
  /**
   * The address they asked to move to, while the link sent there waits to be
   * opened. `email` stays the one they sign in with until it is.
   */
  pendingEmail?: string | null
}

/**
 * What a server is holding, and where.
 *
 * The two halves are not symmetrical and the panel says so: a deduplicated
 * match history takes a long time to trouble a 10 GB database, while replays
 * are tens of megabytes each and are what will fill a volume.
 */
export interface ServerStorageUsage {
  /** False when no blob store is set up, which is a different thing from an empty one. */
  replaysConfigured: boolean
  /** Blobs actually in the store, as the store counts them. */
  replayCount: number
  replayBytes: number
  /** Rows saying a replay was uploaded. Disagreeing with replayCount means a delete failed. */
  replayRecords: number
  matches: number
  matchParticipants: number
  riotAccounts: number
  unclaimedAccounts: number
  rankReadings: number
}

/** A shared replay, as an admin deciding what to delete sees one. */
export interface AdminReplay {
  matchId: string
  patch: string | null
  fileBytes: number | null
  uploadedBy: string | null
  uploadedAt: string | null
}

/**
 * How far through importing a stats.db the server is.
 *
 * Reported rather than returned because the run is minutes long: a Riot lookup
 * per account and a page of matches per request, and a panel sitting on one
 * promise would have nothing to say for any of it.
 */
export interface ImportProgress {
  /**
   * `comparing` is asking the server which of the file's games it already has,
   * before any of their payloads are sent.
   */
  phase: 'accounts' | 'comparing' | 'matches' | 'readings' | 'finishing' | 'done'
  current: number
  /** Zero while finishing, which has no countable work. */
  total: number
}

/**
 * What an import came to.
 *
 * Every count of what was added has a partner for what was not, and the two are
 * never the same number: running the same file a second time is supposed to add
 * nothing, and "added nothing" has to be distinguishable from "could not read
 * it" and from "the file had nothing new in it".
 */
export interface ImportResult {
  ok: boolean
  /** Why it could not run, when it could not. Null on success. */
  message: string | null
  /** Accounts in the file that the server now recognises, new to it or not. */
  accounts: number
  /** Added by this run. */
  matches: number
  /** Added by this run. */
  readings: number
  /** Added by this run. */
  seasons: number
  /** Games the server worked LP out for once everything had arrived. */
  attributed: number
  /**
   * Riot IDs the server could not resolve, almost always renames.
   *
   * Named rather than counted: the fix is to re-add each under the name it
   * plays under now, and that is not something a number can tell anybody.
   */
  unresolved: string[]
  /** What the server already held, and so did not take again. */
  alreadyThere: { matches: number; readings: number; seasons: number }
  /** Games whose payload the server could not read. */
  matchesFailed: number
  /** Readings for an account that never resolved, or a queue the server does not track. */
  readingsUnplaced: number
  /**
   * Games that were stored under an account's dead id by an earlier run and
   * have now been moved onto the one that works, because this run finally
   * resolved the account.
   */
  healed: number
  /**
   * The newest game and the newest rank reading *in the file*, in epoch
   * milliseconds — null where it has none. It is how a run that added nothing
   * tells "the server already has all of it" from "this copy of the file stops
   * three days ago", which is what a file read without its write-ahead log does.
   */
  newest: { matchAt: number | null; readingAt: number | null }
}

/** Credentials for signing in to a server. */
export interface ServerCredentials {
  email: string
  password: string
}

/** Everything needed to make an account on a server. */
export interface ServerRegistration {
  username: string
  email: string
  password: string
  /** Required when the server has public signup switched off. */
  inviteToken?: string
}

/** What a server will say about an invite code without anybody signing in. */
export interface InvitePreview {
  usable: boolean
  serverName: string
  /** The address the invite was sent to, so the form can fill it in. */
  email: string | null
  message: string
}

/** What a server will say about a reset link without anybody signing in. */
export interface PasswordResetPreview {
  usable: boolean
  serverName: string
  /** Whose account the link sets, so nobody types a password for the wrong one. */
  username: string | null
  email: string | null
  message: string
}

/** Changing the password of the account you are signed in to. */
export interface PasswordChange {
  currentPassword: string
  newPassword: string
}

/** Changing the address you sign in with. */
export interface EmailChange {
  email: string
  currentPassword: string
}

/* -------------------------------------------------------------------------- */
/* Server administration                                                      */
/* -------------------------------------------------------------------------- */

/** Somebody on the active server, as an admin sees them. */
export interface AdminUser {
  id: string
  username: string
  email: string
  isAdmin: boolean
  /** Also an admin; may act against other admins. */
  isHeadAdmin: boolean
  /**
   * The account the server's configuration names as its admin. Nobody can
   * demote, disable or remove it from the app — the server refuses — so the
   * page offers none of those for it.
   */
  isConfiguredAdmin: boolean
  /** Cannot sign in. Nothing of theirs is deleted. */
  isDisabled: boolean
  createdAt: string
  linkedRiotAccounts: number
  /** Live sessions — roughly, machines signed in. */
  activeSessions: number
  /**
   * The reset link outstanding for them, or null.
   *
   * On the member rather than behind a call of its own, so the list can say who
   * is waiting on one — and so the admin who made a link an hour ago can copy
   * it again instead of replacing it. Never one the member asked for by email:
   * see `requestedReset`.
   */
  passwordReset: AdminPasswordReset | null
  /** Whether they have confirmed their address. Absent from a server older than mail. */
  emailConfirmed?: boolean
  /** Mail to their address bounced or was reported, and is no longer sent. */
  emailSuppressed?: boolean
  /**
   * A reset they asked for themselves from the sign-in page, still live. Without
   * the link, which went to their inbox and is theirs alone — only when it was
   * made and whether it arrived.
   */
  requestedReset?: AdminRequestedReset | null
}

/** A reset a member asked for by email, as an admin may see it. */
export interface AdminRequestedReset {
  createdAt: string
  expiresAt: string
  mail: EmailDelivery | null
}

/**
 * A password reset link, as the admin who made it sees it.
 *
 * The same arrangement as an invite: the link is readable and copyable and goes
 * wherever the community actually talks — and on a server that sends mail, to
 * the member's confirmed address as well. What differs is what it is worth —
 * an invite makes an account, this hands one over — so it lasts hours rather
 * than a fortnight, and there is never more than one outstanding per member.
 */
export interface AdminPasswordReset {
  id: string
  userId: string
  link: string
  createdAt: string
  expiresAt: string
  /** What became of the email carrying it, when one was sent. */
  mail?: EmailDelivery | null
  /**
   * Why it was not emailed, when it was not: the server sends no mail, the
   * member never confirmed their address, or mail to it bounced.
   */
  notEmailed?: 'email_off' | 'unverified' | 'suppressed' | null
}

/** Which page of the members, and whose name or address to look for. */
export interface AdminUserQuery extends PageOptions {
  /** Part of a username or email, any case. Blank or absent is everybody. */
  q?: string
}

/**
 * What to change about somebody. Undefined leaves a field alone.
 *
 * The roles nest: `isHeadAdmin: true` makes an admin too, and `isAdmin: false`
 * takes head admin with it. Both are a head admin's to change on another admin.
 */
export interface AdminUserPatch {
  isAdmin?: boolean
  isHeadAdmin?: boolean
  isDisabled?: boolean
}

/** An invite, with the link an admin can copy. */
export interface AdminInvite {
  id: string
  /**
   * Who it was made for, when the admin gave an address. Null for a link that
   * registers whoever opens it first.
   */
  email: string | null
  /**
   * The whole point of the admin-facing shape: how an invite travels — pasted
   * wherever your community actually talks, and emailed to its address on a
   * server that sends mail.
   */
  link: string
  createdAt: string
  expiresAt: string
  redeemedAt: string | null
  redeemedBy: string | null
  isOpen: boolean
  /** What became of the email carrying it, when one was sent. */
  mail?: EmailDelivery | null
  /**
   * Whether it can be emailed now: the server sends mail, the invite is open
   * with an address that has not bounced, and nothing for it is on its way or
   * arrived.
   */
  canEmail?: boolean
}

/** The switches an admin can change while the server runs. */
export interface ServerAdminSettings {
  publicSignup: boolean
  backfillTarget: number

  /**
   * How many bytes of blob storage replays may take. Zero means no cap.
   *
   * Uncapped by default, because a cap nobody chose is a cap that surprises
   * somebody — and what it prevents is an upload being refused, which is
   * exactly what the cap does. What it buys a host is deciding when that
   * starts, rather than learning it from a storage bill.
   */
  replayByteCap: number
}

/**
 * The outcome of an administrative action, or of any other write that can be
 * turned away.
 *
 * A result rather than a thrown error, because every one of these can be
 * refused for a reason worth showing — the last administrator cannot be
 * demoted, an invite that has been used cannot be withdrawn, an account synced
 * a minute ago is not synced again yet — and the caller needs the message, not
 * a stack.
 */
export interface AdminActionResult {
  ok: boolean
  error: string | null
}

/* -------------------------------------------------------------------------- */
/* Email                                                                      */
/* -------------------------------------------------------------------------- */

/** What an email the server sends is for. */
export type EmailKind =
  | 'invite'
  | 'password_reset'
  | 'verification'
  | 'email_change'
  | 'password_changed'
  | 'test'

/**
 * Where an email has got to.
 *
 * `held` is waiting on a limit — the day or the month — or on the provider
 * taking this server's mail again. `dropped` was never sent: its link lapsed or
 * was withdrawn first, or the address is one mail is no longer sent to.
 */
export type EmailStatus =
  | 'queued'
  | 'sending'
  | 'held'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'complained'
  | 'failed'
  | 'dropped'

/** What became of the email that carried an invite or a reset. */
export interface EmailDelivery {
  status: EmailStatus
  /** Why, where the status alone does not say: `daily_limit` on a held one, `hard_bounce` on a bounce. */
  reason: string | null
  queuedAt: string
  /** For a held one, when it will be tried again. */
  notBefore: string | null
  sentAt: string | null
  deliveredAt: string | null
}

/** Your own address, as your account settings show it. */
export interface AccountEmail {
  email: string
  emailConfirmed: boolean
  /** The address you asked to move to, while its link waits to be opened. */
  pendingEmail: string | null
  pendingExpiresAt: string | null
  /** When the newest confirmation link was made. */
  lastSentAt: string | null
  /** When another link may be asked for; null when one may be now. */
  canResendAt: string | null
  /** Whether the server sends mail at all. Nothing can be confirmed without it. */
  mailEnabled: boolean
  /** Mail to your address bounced or was reported, and is no longer sent. */
  suppressed: boolean
}

/**
 * What asking for a confirmation link, or cancelling a move, came to — the
 * address as it now stands, or why not.
 */
export interface AccountEmailResult {
  ok: boolean
  error: string | null
  email: AccountEmail | null
}

/** What opening a confirmation link did. */
export interface EmailConfirmation {
  serverName: string
  /** The address now confirmed — for a move, the new one. */
  email: string
  /** `verify` for the address the account had, `change` for a move to a new one. */
  purpose: 'verify' | 'change'
  message: string
}

/** One quota window, as the Email page draws its meter. */
export interface EmailQuotaWindow {
  /** What the limit is checked against: the larger of `ours` and `reported`. */
  used: number
  /** What this server sent in the window. */
  ours: number
  /** What the provider last said had gone — counting mail anything else on the account sent. */
  reported: number | null
  reportedAt: string | null
  /** Zero is no cap. */
  limit: number
  /** How much of the day invites and other standard mail may use. The day only. */
  standardAllowance: number | null
  startsAt: string
  resetsAt: string
  /** When the provider itself said the window is spent. Nothing goes before this. */
  latchedUntil: string | null
}

/** Where a server's mail stands, for its head admins. */
export interface EmailOverview {
  /** Whether the server sends mail at all. Everything else is empty when it does not. */
  configured: boolean
  provider: string | null
  from: string | null
  /** Whether a webhook secret is set, so deliveries and bounces are known. */
  tracksDelivery: boolean
  inviteShare: number
  retentionDays: number
  today: EmailQuotaWindow | null
  month: EmailQuotaWindow | null
  queue: { queued: number; held: number; nextAttemptAt: string | null }
  /** How many addresses mail is no longer sent to. */
  suppressed: number
  /** The provider's reason, while it is refusing this server's mail. */
  refused: string | null
}

/** One email in the log. Never its body, which carried a link. */
export interface EmailLogEntry {
  id: string
  kind: EmailKind
  recipient: string
  subject: string
  status: EmailStatus
  reason: string | null
  /** What the provider said about a bounce or failure. */
  detail: string | null
  attempts: number
  createdAt: string
  /** For one still waiting, when it will next be tried. */
  notBefore: string | null
  sentAt: string | null
  deliveredAt: string | null
  lastEventAt: string | null
  /** Who caused it to be sent, when it was somebody. */
  triggeredBy: string | null
}

/** Which page of the email log, and what to narrow it to. */
export interface EmailLogQuery extends PageOptions {
  kind?: EmailKind
  /** One status, or `pending` for everything still to go. */
  status?: EmailStatus | 'pending'
  /** Part of a recipient's address. */
  q?: string
}

/** An address mail is no longer sent to. */
export interface EmailSuppression {
  id: string
  address: string
  reason: 'hard_bounce' | 'complaint' | 'provider_suppressed'
  detail: string | null
  createdAt: string
  /** Who signs in with the address now, if anybody does. */
  member: string | null
}

export interface EmailSuppressionQuery extends PageOptions {
  q?: string
}
