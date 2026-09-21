import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import type {
  Account,
  FoxfireClient,
  ImportProgress,
  ImportResult,
  QueueType
} from '@foxfire/core'

/** How an action a platform carried out went, when it can fail for a reason worth saying. */
export interface ActionOutcome {
  ok: boolean
  /** Why not, in words the person can act on. */
  message?: string
}

/**
 * What the app hosting the screens can do that a screen cannot do for itself.
 *
 * The screens are the same everywhere; the machine under them is not. A
 * desktop can open a recording in its own window or hand a Riot replay to the
 * League client, and a browser can do neither — but it can download the file.
 * So those abilities arrive here, and every one that is optional is exactly
 * that: a screen offers an action only when the platform supplied it, which is
 * what keeps a browser from showing a menu full of things it can never do.
 */
export interface Platform {
  kind: 'desktop' | 'web'

  copyText: (text: string) => Promise<void>

  /** Opens the LP editor on a game: a window of its own on the desktop, a page in a browser. */
  openLpEditor?: (target: { account: Account; queueType: QueueType; matchId: string }) => void

  /** A recording is footage on this machine's disk, so only a desktop has one to open. */
  watchRecording?: (recordingId: number) => void

  /** Hands a Riot replay to the League client. Can fail for a reason worth saying — no client plays that patch. */
  launchReplay?: (replayId: number) => Promise<ActionOutcome>

  /** Fetches the replay a server holds of a game: into the replay library on a desktop, as a file in a browser. */
  downloadReplay?: (matchId: string) => Promise<ActionOutcome>

  /**
   * Reading an old stats.db, for a server's import.
   *
   * Two steps because choosing the file is where the platforms differ most — a
   * native picker handing back a path, or a file input handing back the bytes —
   * and the page wants to show nothing at all until something was chosen.
   */
  statsDbImport?: {
    pick: () => Promise<{ source: unknown; label: string } | null>
    run: (source: unknown, onProgress: (progress: ImportProgress) => void) => Promise<ImportResult>
  }

  /** Things drawn into shared screens that only this platform has. */
  slots?: {
    /** Beneath the Rank heading. The desktop says there whether the League client is capturing LP. */
    rankHeaderExtra?: ComponentType<{ account: Account }>
  }
}

const ClientContext = createContext<FoxfireClient | null>(null)
const PlatformContext = createContext<Platform | null>(null)

export function ClientProvider({
  client,
  children
}: {
  client: FoxfireClient
  children: ReactNode
}): JSX.Element {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>
}

export function PlatformProvider({
  platform,
  children
}: {
  platform: Platform
  children: ReactNode
}): JSX.Element {
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

/** The client every read and write goes through. */
export function useClient(): FoxfireClient {
  const client = useContext(ClientContext)
  if (!client) throw new Error('A screen was rendered outside ScreensProvider, so it has no client.')
  return client
}

/** What the hosting app can do beyond reading and writing data. */
export function usePlatform(): Platform {
  const platform = useContext(PlatformContext)
  if (!platform) throw new Error('A screen was rendered outside ScreensProvider, so it has no platform.')
  return platform
}
