import { QueryClient } from '@tanstack/react-query'

/**
 * A query client with the defaults every screen was written against.
 *
 * A minute of freshness, because almost everything here changes only when an
 * event says it did — and those invalidate directly. One retry, because a
 * failed read is usually a server that is down, and hammering it does not
 * bring it back.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: 1
      }
    }
  })
}
