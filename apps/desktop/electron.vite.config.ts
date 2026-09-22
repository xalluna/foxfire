import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fsAllow } from '../../tooling/vite/fsAllow'

/**
 * Why @foxfire/core ends up inside the main and preload bundles.
 *
 * externalizeDepsPlugin leaves every package in `dependencies` to be required
 * at runtime from app.asar/node_modules, and bundles everything else. The
 * workspace packages are TypeScript source with no build of their own, so a
 * runtime require of one would load a .ts file and fail — which is why they
 * are listed under devDependencies in package.json, and bundled. What they
 * depend on at runtime (@microsoft/signalr) stays in `dependencies` here, so
 * it goes on being external and packaged exactly as before.
 */
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
        // Dev-server only: the screens are served from packages/, and in a
        // worktree the dependencies may be in the main checkout — see fsAllow.
        allow: fsAllow(__dirname)
      }
    },
    plugins: [react()]
  }
})
