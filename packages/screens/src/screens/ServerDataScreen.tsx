import { useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ImportProgress, ImportResult } from '@foxfire/core'
import { ServerDataPage } from '@foxfire/ui'
import { useClient, usePlatform } from '../client/context'
import { queryKeys } from '../queries/keys'
import { nextOffset, pageItems } from '../queries/paging'

/** Replays per page of the library. */
const REPLAY_PAGE_SIZE = 50

/**
 * The community's data: importing an old stats.db, what the server holds, who
 * has claimed which League account, and the shared replay library.
 */
export function ServerDataScreen(): JSX.Element {
  const client = useClient()
  const platform = usePlatform()
  const queryClient = useQueryClient()

  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const storage = useQuery({ queryKey: queryKeys.admin.storage(), queryFn: () => client.admin.storage() })
  const settings = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: () => client.admin.getSettings()
  })
  // Biggest first, a page at a time: a long-running community's library runs to
  // thousands, and the one somebody came to delete is usually near the top.
  const replays = useInfiniteQuery({
    queryKey: queryKeys.admin.replays(),
    queryFn: ({ pageParam }) => client.admin.storedReplays({ limit: REPLAY_PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: nextOffset
  })

  const importer = platform.statsDbImport

  async function runImport(): Promise<void> {
    if (!importer) return

    const picked = await importer.pick()
    if (picked === null) return

    setRunning(true)
    setResult(null)
    setProgress(null)

    try {
      const outcome = await importer.run(picked.source, setProgress)
      setResult(outcome)

      if (outcome.ok) {
        // Everything on screen is now out of date: the account list grew, and
        // every match row and rank graph has history behind it that was not
        // there a minute ago.
        void queryClient.invalidateQueries()
      }
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  return (
    <ServerDataPage
      importer={
        importer
          ? {
              running,
              progress,
              result,
              onStart: () => void runImport(),
              inBrowser: platform.kind === 'web'
            }
          : undefined
      }
      storage={storage.data}
      replayCap={settings.data?.replayByteCap}
      onSaveReplayCap={async (bytes) => {
        await client.admin.setSettings({ replayByteCap: bytes })
        void queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings() })
      }}
      replays={replays.data === undefined ? undefined : pageItems(replays.data, (replay) => replay.matchId)}
      hasMoreReplays={replays.hasNextPage}
      loadingMoreReplays={replays.isFetchingNextPage}
      onShowMoreReplays={() => void replays.fetchNextPage()}
      onRemoveReplay={async (matchId) => {
        const outcome = await client.admin.removeReplay(matchId)
        if (outcome.ok) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.admin.replays() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.admin.storage() })
        }
        return outcome
      }}
    />
  )
}
