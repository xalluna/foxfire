import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import type { FoxfireClient } from '@foxfire/core'
import { ErrorBoundary } from '@foxfire/ui'
import { ScreensProvider, createQueryClient, type Platform } from '@foxfire/screens'
import { createWebClient } from './client'
import { createWebPlatform } from './platform/webPlatform'
import { createWebRouter } from './router'
import { restore } from './session/session'
import './styles.css'

const RELOADED_KEY = 'foxfire:reloaded-for-assets'

/**
 * One reload when the page asks for a code chunk that is no longer there.
 *
 * Every chunk's name carries a hash of its contents, and the server keeps only
 * the current build's. A tab opened before an upgrade that then navigates to a
 * page it has not loaded yet asks for a chunk from the old build and gets a
 * 404. Reloading fetches the new build; the flag stops a loop if something
 * else is wrong, and is cleared once a load has settled.
 */
function recoverFromStaleAssets(): void {
  window.addEventListener('vite:preloadError', (event) => {
    try {
      if (sessionStorage.getItem(RELOADED_KEY)) return
      sessionStorage.setItem(RELOADED_KEY, '1')
    } catch {
      return
    }
    event.preventDefault()
    window.location.reload()
  })

  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOADED_KEY)
    } catch {
      // Nothing to clear.
    }
  }, 10_000)
}

async function start(): Promise<void> {
  recoverFromStaleAssets()

  const queryClient = createQueryClient()
  const router = createWebRouter()
  const navigate = (href: string): void => void router.navigate({ href })

  let client: FoxfireClient
  let platform: Platform

  if (import.meta.env.MODE === 'mock') {
    // The design harness: fixtures instead of a server, somebody already
    // signed in. The dynamic import keeps every fixture out of a real build.
    const { startMock } = await import('./dev/mock')
    ;({ client, platform } = startMock(navigate))
  } else {
    const web = createWebClient()
    client = web
    platform = createWebPlatform({ api: web.api, navigate })

    // Before the first route renders, so the router knows whether anybody is
    // signed in. No session, or a server that cannot be reached, is somebody
    // signed out — the sign-in page says the rest.
    await restore().catch(() => undefined)
  }

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
