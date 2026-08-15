import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './App'
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

  const root = ReactDOM.createRoot(document.getElementById('root')!)

  // The telemetry panel is a second BrowserWindow loading this same bundle with
  // a #telemetry hash, so there is no second Vite entry point to keep in step.
  // The dynamic import means the main window never downloads or parses it.
  const Root =
    window.location.hash === '#telemetry'
      ? (await import('./telemetry/TelemetryApp')).TelemetryApp
      : App

  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <Root />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

void start()
