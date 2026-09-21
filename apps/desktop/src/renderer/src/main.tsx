import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { ErrorBoundary } from '@foxfire/ui'
import { ScreensProvider, createQueryClient } from '@foxfire/screens'
import { createIpcClient } from './platform/ipcClient'
import { createDesktopPlatform } from './platform/desktopPlatform'
import { router } from './router'
import './styles/index.css'

/**
 * Outside Electron there is no contextBridge, so window.api is undefined and
 * every screen would fail. In dev only, fall back to the fixture-backed mock
 * so the UI can be developed and reviewed in an ordinary browser
 * (`npm run dev:web`). The dynamic import keeps the fixtures out of the
 * production bundle entirely.
 */
async function start(): Promise<void> {
  if (import.meta.env.DEV && !window.api) {
    const { installMockApi } = await import('./dev/mockApi')
    installMockApi()
  }

  // The shared screens read through a client and ask a platform for what this
  // machine can do. Both are window.api underneath; the main process still
  // decides where every answer comes from.
  const client = createIpcClient(window.api)
  const platform = createDesktopPlatform(window.api)
  const queryClient = createQueryClient()

  // Every window loads this bundle, and the router picks what it shows from the
  // address it was opened at — the main window at `/`, the others at their own
  // routes. See router.tsx.
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ScreensProvider client={client} platform={platform}>
            <RouterProvider router={router} />
          </ScreensProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

void start()
