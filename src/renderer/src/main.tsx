import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
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

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </React.StrictMode>
  )
}

void start()
