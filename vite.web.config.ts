import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  plugins: [react()],
  server: {
    port: 5199,
    strictPort: true
  }
})
