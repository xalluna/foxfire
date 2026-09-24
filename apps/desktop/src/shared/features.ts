/**
 * What this build of Foxfire was made with.
 *
 * Decided when the installer is built, not when it runs: electron-vite
 * replaces `__FEATURE_YOUTUBE__` with a literal from the FOXFIRE_FEATURE_YOUTUBE
 * environment variable (see electron.vite.config.ts), and the release workflow
 * sets that from a repository variable. Nobody with the installer can turn a
 * feature on that the build left off.
 *
 * Shared by main and the renderer so the two can never disagree about whether
 * a feature exists — main registering nothing for it, and the renderer drawing
 * nothing that would ask.
 */
declare const __FEATURE_YOUTUBE__: boolean | undefined

/**
 * Recordings on YouTube: the Google connection, uploads, attaching videos on a
 * server, and playing them from there. Off until Foxfire's Google project has
 * been through YouTube's review — see docs/YOUTUBE_SETUP.md.
 *
 * The `typeof` guard is for code run without the build's replacement at all —
 * a test, a script — where the identifier does not exist; it reads as off.
 */
export const YOUTUBE_ENABLED: boolean = typeof __FEATURE_YOUTUBE__ !== 'undefined' && __FEATURE_YOUTUBE__ === true
