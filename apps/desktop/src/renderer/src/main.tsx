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

  // The telemetry panel, the LP editor, the archive manager and every recording
  // window are separate
  // BrowserWindows loading this same bundle with a hash, so there is no second
  // Vite entry point to keep in step. The dynamic imports mean no window
  // downloads or parses a panel it is not showing. The editor and recording hashes
  // carry query parameters after them, so they are matched by prefix — see
  // lpEditorWindow.ts and recordingWindow.ts.
  const hash = window.location.hash
  const Root = hash.startsWith('#telemetry')
    ? (await import('./telemetry/TelemetryApp')).TelemetryApp
    : hash.startsWith('#lp-editor')
      ? (await import('./lpEditor/LpEditorApp')).LpEditorApp
      : hash.startsWith('#recording')
        ? (await import('./recording/RecordingApp')).RecordingApp
        : hash.startsWith('#archives')
          ? (await import('./archives/ArchivesApp')).ArchivesApp
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
