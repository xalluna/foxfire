import { dirname, join, resolve } from 'path'
import { existsSync, readdirSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
 * Normally that is this directory, and this returns it unchanged. In a git
 * worktree it is the main checkout: the worktree has its own package.json, so
 * Vite takes the worktree as the workspace root and then refuses to serve the
 * @fontsource files, which resolve to node_modules a level above it. The app
 * loads but renders in fallback system fonts, which looks like a regression and
 * is not one.
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    server: {
      fs: {
        // Dev-server only, and a no-op outside a worktree — see dependencyRoot.
        allow: [__dirname, dependencyRoot(__dirname)]
      }
    },
    plugins: [react()]
  }
})
