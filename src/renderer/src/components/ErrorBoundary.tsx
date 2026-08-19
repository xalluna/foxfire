import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Logo } from './Logo'

/**
 * Catches render errors that would otherwise blank the window.
 *
 * Without this, a thrown error during render unmounts the whole tree and leaves
 * a black window with nothing in it and nothing in any log — the renderer has
 * no file access, so its console is the only record and it disappears with the
 * process. Reporting to main puts it in the same log file as everything else.
 */
interface Props {
  children: ReactNode
}

interface State {
  message: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Renderer error boundary caught:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.message === null) return this.props.children

    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-8">
        <div className="max-w-md rounded-lg border border-red/40 bg-surface p-6">
          <div className="flex items-center gap-2.5">
            <Logo width={18} height={18} className="shrink-0 text-red" />
            <h1 className="font-display text-lg text-red">Something broke</h1>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-text-dim">
            The interface hit an error it could not recover from. Reloading usually clears it; the
            details are below and in the app log.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-md border border-hairline bg-canvas p-3 font-mono text-2xs text-text-mute">
            {this.state.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md border border-accent-dim bg-accent/10 px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent/20"
          >
            Reload
          </button>
        </div>
      </div>
    )
  }
}
