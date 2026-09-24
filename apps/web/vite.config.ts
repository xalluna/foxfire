import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { featureDefines } from '../../tooling/vite/features'
import { fsAllow } from '../../tooling/vite/fsAllow'

/**
 * The web client.
 *
 * In production it is built into the Foxfire Server's image and archives and
 * served by the server it talks to, from the same origin — see
 * apps/server/src/Foxfire.Api/Web/SpaHosting.cs. That is what binds a hosted
 * web client to exactly one server.
 *
 * In development Vite serves it and forwards the API, its hub's WebSocket
 * included, to a server running elsewhere — FOXFIRE_SERVER, by default
 * http://localhost:8080 — so the page still sees one origin, and the session
 * cookie behaves as it will in production.
 *
 * `--mode mock` needs no server at all: it renders the fixture client, for
 * design work. See src/dev/mock.ts.
 */
export default defineConfig(({ mode }) => {
  const server = process.env.FOXFIRE_SERVER ?? 'http://localhost:8080'

  return {
    // Build-time feature switches, the same ones the server is compiled with
    // when a release builds both — see tooling/vite/features.ts.
    define: featureDefines(),
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      // The screens are served from packages/, outside this app — see fsAllow.
      fs: { allow: fsAllow(__dirname) },
      proxy:
        mode === 'mock'
          ? undefined
          : {
              '/api': { target: server, ws: true },
              '/version': server,
              '/health': server
            }
    },
    build: {
      outDir: 'dist',
      sourcemap: true
    }
  }
})
