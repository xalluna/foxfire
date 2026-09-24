/**
 * What the main process is built with.
 *
 * electron-vite exposes MAIN_VITE_* from the environment at build time, which
 * is how the release workflow puts Foxfire's Google client into the installer
 * without it ever being written into the repository. A build without the id —
 * a contributor's, or CI's — simply has no YouTube uploads, and says so; the
 * secret is optional, and sent only when there is one. See youtube/config.ts.
 */
interface ImportMetaEnv {
  readonly MAIN_VITE_YOUTUBE_CLIENT_ID?: string
  readonly MAIN_VITE_YOUTUBE_CLIENT_SECRET?: string
}

/** The YouTube host page, bundled as text. See youtube/hostProtocol.ts. */
declare module '*.html?raw' {
  const content: string
  export default content
}

declare module '*.js?raw' {
  const content: string
  export default content
}
