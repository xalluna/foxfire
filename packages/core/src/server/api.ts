import type {
  Account,
  AdHocSummonerResult,
  AdminActionResult,
  AdminInvite,
  AdminReplay,
  AdminUser,
  AdminUserPatch,
  ChampionStats,
  DashboardData,
  EditableMatch,
  ManualRankEdit,
  MasteryData,
  MatchDetail,
  MatchSummary,
  QueueType,
  RankHistory,
  RankRange,
  RiotIdInput,
  Season,
  SeasonInput,
  ServerAdminSettings,
  ServerStorageUsage,
  SyncState
} from '../types'
import { silentLogger, type Logger } from '../log'
import type {
  ImportAccountResult,
  ImportAccountRow,
  ImportMatchRow,
  ImportReadingRow,
  ImportSeasonRow
} from '../import/rows'
import { ServerError } from './errors'

/** A request to the server with a live session behind it, to a path under the API base. */
export type AuthedRequest = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<T>

/** What the server hands out in place of a replay: a URL signed for a quarter of an hour. */
export interface ReplayDownloadGrant {
  matchId: string
  downloadUrl: string
  expiresAt: string
}

/** A match row as the server sends it: everything except what is on somebody's disk. */
export type ServerMatchSummary = Omit<MatchSummary, 'local'>

/**
 * Every route both clients call on a Foxfire server, typed.
 *
 * Only the routes and the shapes. The session behind `request` owns the access
 * token, its renewal and the version gate, so none of that is repeated here —
 * and neither is any decision, because the server made those and the shapes it
 * sends were chosen to be the shapes the screens already read.
 *
 * Routes only the desktop has a use for — the League client's rank readings,
 * uploading a replay, binding a recording — stay in the desktop beside the
 * code that has something to report.
 *
 * Reads throw and admin writes return a result, which is a deliberate
 * asymmetry. A read that fails has nothing to show and the query layer already
 * knows how to render that. A write that fails usually failed for a reason the
 * person needs to read — the last administrator cannot be demoted, an invite
 * that has been used cannot be withdrawn — and a message they can act on is
 * the entire point of having asked.
 *
 * Nothing here is gated on the caller being an admin. The server decides that,
 * and it decides it on every request; a check here would only be a second
 * opinion that could disagree after somebody was demoted mid-session.
 */
export function createServerApi(request: AuthedRequest, options: { log?: Logger } = {}) {
  const log = options.log ?? silentLogger

  /**
   * Turns a refusal into something to show, and anything else into a log line.
   *
   * The server writes these messages and they are meant to be read, so they are
   * passed through unchanged rather than translated into a second vocabulary
   * that would drift from the first.
   */
  async function attempt(run: () => Promise<unknown>): Promise<AdminActionResult> {
    try {
      await run()
      return { ok: true, error: null }
    } catch (err) {
      if (!(err instanceof ServerError)) log.error('An admin action failed', err)

      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  const editable = (accountId: string, queueType: QueueType): Promise<EditableMatch[]> =>
    request<EditableMatch[]>(`/riot-accounts/${accountId}/rank/editable?queueType=${queueType}`)

  return {
    accounts: {
      list: () => request<Account[]>('/riot-accounts'),

      /**
       * Claims a League account for the signed-in member. First claim wins.
       *
       * The server resolves the Riot ID with its own key. Which Riot ID to send
       * is the caller's business, and the desktop only ever sends the one the
       * League client on that machine says is logged in.
       */
      link: (input: RiotIdInput) =>
        request<Account>('/riot-accounts', {
          method: 'POST',
          body: { gameName: input.gameName, tagLine: input.tagLine }
        }),

      /**
       * Gives up a claim rather than deleting anything. On a shared server the
       * games are everybody's — the same match rows are on nine other people's
       * history — so an account returns to unclaimed and keeps what it played.
       */
      release: (accountId: string) =>
        request<void>(`/riot-accounts/${accountId}`, { method: 'DELETE' })
    },

    dashboard: {
      get: (accountId: string) =>
        request<DashboardData | null>(`/riot-accounts/${accountId}/dashboard`),

      matches: (accountId: string, limit: number, offset: number, queueId: number | null) => {
        const query = new URLSearchParams({ limit: String(limit), offset: String(offset) })
        if (queueId !== null) query.set('queueId', String(queueId))

        return request<ServerMatchSummary[]>(`/riot-accounts/${accountId}/matches?${query}`)
      },

      matchDetail: (matchId: string) =>
        request<MatchDetail | null>(`/matches/${encodeURIComponent(matchId)}`)
    },

    sync: {
      start: (accountId: string) => request<void>(`/sync/${accountId}`, { method: 'POST' }),
      getState: (accountId: string) => request<SyncState | null>(`/sync/${accountId}`)
    },

    champions: {
      stats: (accountId: string, queueId: number | null, range: RankRange) => {
        const query = new URLSearchParams({ range })
        if (queueId !== null) query.set('queueId', String(queueId))

        return request<ChampionStats[]>(`/riot-accounts/${accountId}/champions?${query}`)
      }
    },

    mastery: {
      get: (accountId: string, refresh: boolean, queueId: number | null) => {
        const query = new URLSearchParams({ refresh: String(refresh) })
        if (queueId !== null) query.set('queueId', String(queueId))

        return request<MasteryData>(`/riot-accounts/${accountId}/mastery?${query}`)
      }
    },

    rank: {
      history: (accountId: string, queueType: QueueType, range: RankRange) =>
        request<RankHistory>(
          `/riot-accounts/${accountId}/rank/history?queueType=${queueType}&range=${range}`
        ),

      periods: (accountId: string) => request<Season[]>(`/riot-accounts/${accountId}/rank/periods`),

      editable,

      // Both writers return the fresh list, because an edit can resolve a
      // neighbouring game on its own. Neither announces anything: a server's
      // writes arrive back over its own event stream, which is what the hub is
      // for, and telling anybody here as well would fire the refresh twice.
      saveManual: async (accountId: string, queueType: QueueType, edits: ManualRankEdit[]) => {
        await request<void>(`/riot-accounts/${accountId}/rank/manual`, {
          method: 'POST',
          body: { queueType, edits }
        })

        return editable(accountId, queueType)
      },

      clearManual: async (accountId: string, queueType: QueueType, matchId: string) => {
        await request<void>(
          `/riot-accounts/${accountId}/rank/manual/${encodeURIComponent(matchId)}`,
          { method: 'DELETE' }
        )

        return editable(accountId, queueType)
      }
    },

    seasons: {
      list: () => request<Season[]>('/seasons'),

      save: async (seasons: SeasonInput[]) => {
        await request<void>('/seasons', { method: 'PUT', body: seasons })
        return request<Season[]>('/seasons')
      }
    },

    search: {
      summoner: (input: RiotIdInput) =>
        request<AdHocSummonerResult>(
          `/search?gameName=${encodeURIComponent(input.gameName)}`
            + `&tagLine=${encodeURIComponent(input.tagLine)}`
        )
    },

    replays: {
      /** A signed URL for the replay this server holds of a game. Throws when it holds none. */
      downloadGrant: (matchId: string) =>
        request<ReplayDownloadGrant>(`/replays/${encodeURIComponent(matchId)}/download`)
    },

    admin: {
      storage: () => request<ServerStorageUsage>('/admin/storage/'),

      /** The biggest shared replays, so space can be reclaimed where it actually is. */
      storedReplays: () => request<AdminReplay[]>('/admin/storage/replays'),

      /**
       * Removes a shared replay, blob and record.
       *
       * A write, so it answers with a result rather than throwing: the reason it
       * failed is usually one the person can act on, and a community's library
       * is not a thing to delete from silently.
       */
      removeReplay: (matchId: string) =>
        attempt(() => request<void>(`/replays/${encodeURIComponent(matchId)}`, { method: 'DELETE' })),

      /** Takes a League account away from whoever claimed it. The games stay. */
      forceUnlink: (riotAccountId: string) =>
        attempt(() =>
          request<void>(`/admin/riot-accounts/${encodeURIComponent(riotAccountId)}/owner`, {
            method: 'DELETE'
          })
        ),

      users: () => request<AdminUser[]>('/admin/users/'),

      updateUser: (id: string, patch: AdminUserPatch) =>
        attempt(() =>
          request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
        ),

      deleteUser: (id: string) =>
        attempt(() => request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })),

      invites: () => request<AdminInvite[]>('/admin/invites/'),

      /**
       * Creates an invite, or hands back the one already outstanding for that
       * address.
       *
       * The server does the deduplicating. An admin who cannot remember whether
       * they already sent one gets the link that is in somebody's inbox rather
       * than a second one that quietly does nothing.
       */
      createInvite: (email: string) =>
        request<AdminInvite>('/admin/invites/', { method: 'POST', body: { email } }),

      revokeInvite: (id: string) =>
        attempt(() => request<void>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' })),

      getSettings: () => request<ServerAdminSettings>('/admin/settings/'),

      setSettings: (patch: Partial<ServerAdminSettings>) =>
        request<ServerAdminSettings>('/admin/settings/', { method: 'PATCH', body: patch })
    },

    /** The endpoints an old stats.db is pushed through. See import/statsDbImporter. */
    importer: {
      accounts: (rows: ImportAccountRow[]) =>
        request<ImportAccountResult[]>('/admin/import/accounts', { method: 'POST', body: rows }),

      seasons: (rows: ImportSeasonRow[]) =>
        request<{ accepted: number }>('/admin/import/seasons', { method: 'POST', body: rows }),

      matches: (rows: ImportMatchRow[]) =>
        request<{ accepted: number }>('/admin/import/matches', { method: 'POST', body: rows }),

      rankReadings: (rows: ImportReadingRow[]) =>
        request<{ accepted: number }>('/admin/import/rank-readings', { method: 'POST', body: rows }),

      finish: () =>
        request<{ accounts: number; attributed: number }>('/admin/import/finish', { method: 'POST' })
    }
  }
}

export type ServerApi = ReturnType<typeof createServerApi>
