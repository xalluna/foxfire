/**
 * What this build of the web client was made with.
 *
 * Decided when the server's release builds the page, not when it runs: Vite
 * replaces `__FEATURE_YOUTUBE__` with a literal from the FOXFIRE_FEATURE_YOUTUBE
 * environment variable (see vite.config.ts and tooling/vite/features.ts), and
 * the release workflow compiles the server with the same switch — so a page and
 * the server that serves it always agree about whether a feature exists.
 */
declare const __FEATURE_YOUTUBE__: boolean | undefined

/**
 * Recordings on YouTube: the recording page, the row's marker and menu items,
 * and attaching a link. Off until Foxfire's Google project has been through
 * YouTube's review — see apps/desktop/docs/YOUTUBE_SETUP.md.
 *
 * The `typeof` guard is for code run without the build's replacement at all —
 * a test — where the identifier does not exist; it reads as off.
 */
export const YOUTUBE_ENABLED: boolean = typeof __FEATURE_YOUTUBE__ !== 'undefined' && __FEATURE_YOUTUBE__ === true
