/**
 * Who a client says it is, which the server's version gate judges.
 *
 * Two kinds, judged two ways. A desktop sends its own version, and the server
 * holds an exact allow list of the builds it serves — which is also what the
 * desktop's updater reads to decide which build to be, so this handshake
 * settles both whether the two can talk and what to install if they cannot. The web client ships inside the server that serves it, so its
 * version is never in doubt; what can go stale is a tab left open across an
 * upgrade, and that is caught by the API version the page was built against.
 */
export type ClientIdentity =
  | { kind: 'desktop'; version: string }
  | { kind: 'web'; apiVersion: number }

/**
 * The API version the web client is built against.
 *
 * Bumped together with the server's contract, and held to it by a test on the
 * server side (DesktopCompatibilityTests) that reads this line: the server
 * lists the versions it serves in DesktopCompatibility.WebApiVersions, and a
 * web client built for one missing from there would be refused on every call.
 */
export const WEB_API_VERSION = 2

/** What every request says the caller is. */
export const CLIENT_HEADER = 'X-Foxfire-Client'

/** Sent beside `X-Foxfire-Client: web`: the API version the page was built against. */
export const API_VERSION_HEADER = 'X-Foxfire-Api-Version'

/** The headers that name a client, sent on every request including the unauthenticated ones. */
export function identityHeaders(identity: ClientIdentity): Record<string, string> {
  return identity.kind === 'desktop'
    ? { [CLIENT_HEADER]: identity.version }
    : { [CLIENT_HEADER]: 'web', [API_VERSION_HEADER]: String(identity.apiVersion) }
}

/**
 * The same, for the one connection that cannot carry headers.
 *
 * A browser cannot put a header on a WebSocket or an EventSource, so the web
 * client names itself in the hub's query string instead. A desktop's socket is
 * opened by Node, which can, so it has nothing to add here.
 */
export function identityQuery(identity: ClientIdentity): Record<string, string> {
  return identity.kind === 'desktop'
    ? {}
    : { client: 'web', apiVersion: String(identity.apiVersion) }
}
