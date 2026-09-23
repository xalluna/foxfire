/**
 * The shapes a Foxfire Server speaks in, beyond the League data itself.
 *
 * Joining, signing in, invites, and administering a server. Both clients read
 * these: the desktop from its main process, the web client from the browser.
 */

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
}

/** Who you are on a server, as the server says it. */
export interface SessionUser {
  id: string
  username: string
  email: string
  isAdmin: boolean
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
  phase: 'accounts' | 'matches' | 'readings' | 'finishing' | 'done'
  current: number
  /** Zero while finishing, which has no countable work. */
  total: number
}

/** What an import came to. */
export interface ImportResult {
  ok: boolean
  /** Why it could not run, when it could not. Null on success. */
  message: string | null
  accounts: number
  matches: number
  readings: number
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
   * it again instead of replacing it.
   */
  passwordReset: AdminPasswordReset | null
}

/**
 * A password reset link, as the admin who made it sees it.
 *
 * The same arrangement as an invite, and for the same reason: this server sends
 * no mail, so the link is readable and copyable and goes wherever the community
 * actually talks. What differs is what it is worth — an invite makes an
 * account, this hands one over — so it lasts hours rather than a fortnight, and
 * there is never more than one outstanding per member.
 */
export interface AdminPasswordReset {
  id: string
  userId: string
  link: string
  createdAt: string
  expiresAt: string
}

/** What to change about somebody. Undefined leaves a field alone. */
export interface AdminUserPatch {
  isAdmin?: boolean
  isDisabled?: boolean
}

/** An invite, with the link an admin can copy. */
export interface AdminInvite {
  id: string
  email: string
  /**
   * The whole point of the admin-facing shape. SMTP is optional, so every link
   * the server would have emailed is also copyable — paste it wherever your
   * community actually talks.
   */
  link: string
  createdAt: string
  expiresAt: string
  redeemedAt: string | null
  redeemedBy: string | null
  isOpen: boolean
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
 * The outcome of an administrative action.
 *
 * A result rather than a thrown error, because every one of these can be
 * refused for a reason worth showing — the last administrator cannot be
 * demoted, an invite that has been used cannot be withdrawn — and the caller
 * needs the message, not a stack.
 */
export interface AdminActionResult {
  ok: boolean
  error: string | null
}
