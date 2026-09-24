import { RELEASES_URL } from './feed'

/** A hung request should not leave a check hanging until the next one. */
const TIMEOUT_MS = 10_000

/**
 * The version in a desktop release tag, or null for anything else.
 *
 * Anything else is not an error worth reporting. Both apps release out of this
 * repository and the desktop is the one that takes the Latest badge, so a
 * `server-v` tag here means a release went out without `--latest=false` — a
 * mistake to fix in the workflow, not a reason to install something. The old
 * bare `v0.11.0` spelling is refused for the same reason: no build old enough
 * to wear it can be newer than one asking this question.
 */
export function desktopVersionFromTag(tag: string): string | null {
  const match = /^desktop-v(\d+\.\d+\.\d+)$/.exec(tag.trim())
  return match ? match[1] : null
}

/**
 * The newest desktop release GitHub knows about.
 *
 * Read from the repository's own `releases/latest`, which answers JSON with the
 * tag on it when asked for JSON. That endpoint rather than the REST API
 * deliberately: the API allows sixty unauthenticated calls an hour from one
 * address, which a household behind one connection could plausibly spend, and
 * this needs no such budget. It is also the same endpoint electron-updater's
 * own GitHub provider uses to answer the same question.
 *
 * Only consulted in local-only mode and to explain a hold — connected to a
 * server, what that server accepts is what gets installed.
 */
export async function newestDesktopVersion(fetchImpl: typeof fetch): Promise<string | null> {
  const response = await fetchImpl(`${RELEASES_URL}/latest`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })

  if (!response.ok) return null

  const body = (await response.json()) as { tag_name?: unknown }
  return typeof body.tag_name === 'string' ? desktopVersionFromTag(body.tag_name) : null
}
