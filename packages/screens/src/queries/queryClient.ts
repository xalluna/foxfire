import { QueryClient } from '@tanstack/react-query'

/** Whether a failed read was the server saying this reader may not have it. */
export function isRefused(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 401
}

/**
 * A query client with the defaults every screen was written against.
 *
 * A minute of freshness, because almost everything here changes only when an
 * event says it did — and those invalidate directly. One retry, because a
 * failed read is usually a server that is down, and hammering it does not
 * bring it back — but none for a refusal, which is somebody reading without an
 * account asking for something they cannot have, and will be told the same
 * again.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: (failures, error) => !isRefused(error) && failures < 1
      }
    }
  })
}
