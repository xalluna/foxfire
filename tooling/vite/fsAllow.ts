import { dirname, join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { searchForWorkspaceRoot } from 'vite'

/**
 * What a Vite dev server in this repo may serve from disk.
 *
 * Shared by every app's Vite config, because every one of them has the same
 * two problems. The screens are TypeScript source in packages/, outside the
 * app's own folder, so the workspace root has to be allowed or the dev server
 * refuses to serve them. And in a git worktree the dependencies may live in
 * the main checkout rather than beside the app — see dependencyRoot.
 */
export function fsAllow(appDir: string): string[] {
  return [searchForWorkspaceRoot(appDir), dependencyRoot(appDir)]
}

/**
 * Whether dependencies are actually installed here.
 *
 * Checking the directory exists is not enough: Vite writes its own
 * dep-optimisation cache to node_modules/.vite, so a worktree that has never
 * been installed into still grows an otherwise empty node_modules the first
 * time the dev server runs. Only a non-dot entry means real packages.
 */
function hasDependencies(dir: string): boolean {
  const modules = join(dir, 'node_modules')
  if (!existsSync(modules)) return false
  return readdirSync(modules).some((entry) => !entry.startsWith('.'))
}

/**
 * The directory whose node_modules actually gets used, walking up from here.
 *
 * Normally that is the workspace root, and this returns it unchanged. In a git
 * worktree nobody has installed into, it is the main checkout: the worktree has
 * its own package.json, so Vite takes the worktree as the workspace root and
 * then refuses to serve the @fontsource files, which resolve to node_modules
 * above it. The app loads but renders in fallback system fonts, which looks
 * like a regression and is not one.
 */
function dependencyRoot(from: string): string {
  let dir = from
  while (!hasDependencies(dir)) {
    const parent = dirname(dir)
    if (parent === dir) return from
    dir = parent
  }
  return dir
}
