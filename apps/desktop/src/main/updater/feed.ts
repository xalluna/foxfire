/**
 * Where this app's releases live, and which of their files the updater reads.
 *
 * The one place in the desktop that names the repository. electron-builder.yml
 * names it too, for the `latest.yml` it writes — the two describe the same
 * releases from opposite ends, and both have to be changed if this ever moves.
 */
export const RELEASES_URL = 'https://github.com/xalluna/foxfire/releases'

/**
 * The tag a desktop release is published under.
 *
 * Named for the app because two things release out of this repository; see
 * CLAUDE.md. Everything the updater fetches hangs off this, so the prefix is
 * stated once.
 */
export function desktopTag(version: string): string {
  return `desktop-v${version}`
}

/**
 * The folder electron-updater reads a given version out of.
 *
 * A generic feed pointed at one release's assets rather than the github
 * provider pointed at the repository, for two reasons. The provider resolves
 * "latest" for itself, and this app does not want the latest — it wants the
 * version its server will accept. And the assets of two apps share one release
 * list here, so "latest" is not always a desktop build at all.
 *
 * Naming the version in the path is also what keeps delta downloads working:
 * electron-updater finds the installed build's blockmap by swapping the
 * version inside this URL, which only works because it appears in it — twice,
 * in the tag and in the file name, and it substitutes both.
 *
 * The override exists to rehearse an update against a folder on this machine,
 * which is the only way to exercise the install path without publishing two
 * releases. It is read from the environment, so nothing an ordinary run does
 * can reach it.
 */
export function feedUrl(version: string, override = overrideFeed()): string {
  return override ?? `${RELEASES_URL}/download/${desktopTag(version)}`
}

/**
 * A feed named in the environment, or null for the ordinary case.
 *
 * Stated once and read twice, because it does two things. It replaces the URL
 * above, and it replaces the question that URL is usually the answer to: a
 * folder on a test machine has no releases page to read a newest version from
 * and no server with an opinion about it, so when this is set the feed itself
 * is the authority. See checkForUpdates.
 */
export function overrideFeed(): string | null {
  return process.env.FOXFIRE_UPDATE_FEED ?? null
}

/** The release page for a version — the fallback when the updater cannot. */
export function releasePageUrl(version: string): string {
  return `${RELEASES_URL}/tag/${desktopTag(version)}`
}
