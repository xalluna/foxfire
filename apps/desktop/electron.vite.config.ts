import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { featureDefines } from '../../tooling/vite/features'
import { fsAllow } from '../../tooling/vite/fsAllow'

// The same build-time feature switches for all three halves, so main, the
// preload and the renderer cannot be built disagreeing about whether a feature
// exists. See tooling/vite/features.ts and src/shared/features.ts.
const features = featureDefines()

/**
 * Fails the build if the preloads share a chunk.
 *
 * Every window runs sandboxed, and a sandboxed preload cannot load a file of
 * its own beside it — so when two preload entries import the same module and
 * Rollup splits it out, both break at runtime, with nothing wrong until a
 * window opens. The native recorder's audio page has a preload of its own, and
 * the two must import nothing in common; this is what keeps that true.
 */
function preloadsStandAlone(): Plugin {
  return {
    name: 'foxfire-preloads-stand-alone',
    generateBundle(_options, bundle) {
      const shared = Object.values(bundle).filter((file) => file.type === 'chunk' && !file.isEntry)
      if (shared.length > 0) {
        this.error(
          `Preloads must not share code — sandboxed, they cannot load ${shared
            .map((file) => file.fileName)
            .join(', ')}. Keep the modules each preload imports apart.`
        )
      }
    }
  }
}

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
    define: features,
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
    define: features,
    plugins: [externalizeDepsPlugin(), preloadsStandAlone()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          // The native recorder's audio page, which gets this and nothing else.
          captureAudio: resolve(__dirname, 'src/preload/captureAudio.ts')
        }
      }
    }
  },
  renderer: {
    define: features,
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
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          // Hidden, and no React: the native recorder's audio page.
          captureAudio: resolve(__dirname, 'src/renderer/capture-audio.html')
        }
      }
    },
    plugins: [react()]
  }
})
