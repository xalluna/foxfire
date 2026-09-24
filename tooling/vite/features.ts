/**
 * The build-time feature switches every app's Vite config shares.
 *
 * Read from the environment of whoever runs the build — the release workflows
 * set them from repository variables — and turned into `define`s, so the
 * answer is a literal in the bundle rather than something the app looks up
 * while it runs. Nobody holding a build can switch on what it was built
 * without.
 *
 * The server reads the same variable when it is compiled — see
 * apps/server/Directory.Build.props — so one variable decides a whole release.
 */
function isOn(value: string | undefined): boolean {
  return value !== undefined && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

/** Recordings on YouTube. Off unless FOXFIRE_FEATURE_YOUTUBE says otherwise. */
export function featureDefines(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return {
    __FEATURE_YOUTUBE__: JSON.stringify(isOn(env.FOXFIRE_FEATURE_YOUTUBE))
  }
}
