import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { featureDefines } from '../../tooling/vite/features'
import { fsAllow } from '../../tooling/vite/fsAllow'

/**
 * Serves the renderer as a plain web app for design work — `npm run dev:web`.
 *
 * The Electron build is unaffected; electron.vite.config.ts remains the real
 * config. This one exists because the renderer is ordinary React and benefits
 * from being reviewable in a browser, where every screen can be reached
 * instantly via the ?scenario= switch in src/renderer/src/dev/mockApi.ts
 * instead of requiring a live Riot key and a synced database.
 *
 * window.api is absent here, so main.tsx installs the fixture-backed mock.
 */
export default defineConfig({
  root: 'src/renderer',
  // The same switches as a real build, so the harness shows what the
  // installer would: FOXFIRE_FEATURE_YOUTUBE=1 npm run dev:web for YouTube.
  define: featureDefines(),
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true,
    // The screens are served from packages/, outside this app — see fsAllow.
    fs: { allow: fsAllow(__dirname) }
  }
})
