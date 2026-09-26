import type {
  Account,
  AdminActionResult,
  AdminInvite,
  AdminPasswordReset,
  AdminReplay,
  AdminUser,
  AdminUserPatch,
  AdminUserQuery,
  AttachRecordingInput,
  AttachRecordingOutcome,
  ChampionStats,
  DashboardData,
  EditableMatch,
  InsightsSection,
  InsightsSections,
  InsightsWindow,
  ManualRankEdit,
  MasteryData,
  MatchDetail,
  MatchRecording,
  MatchSummary,
  Page,
  PageOptions,
  PlayerSearchOptions,
  PlayerSearchResult,
  QueueType,
  RankHistory,
  RankRange,
  RankTrend,
  RiotIdInput,
  Season,
  SeasonInput,
  ServerAdminSettings,
  ServerLogEntry,
  ServerLogQuery,
  ServerStorageUsage,
  SyncState
} from '../types'
import { silentLogger, type Logger } from '../log'
import type {
  ImportAccountResult,
  ImportAccountRow,
  ImportBatchOutcome,
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
 * A path with a query string of whichever values are set — a left-out limit is
 * the server's default page, not `limit=undefined`.
 */
function withQuery(path: string, params: Record<string, string | number | undefined>): string {
  const query = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&')

  return query ? `${path}?${query}` : path
}

function recordingPath(accountId: string, matchId: string): string {
  return `/riot-accounts/${encodeURIComponent(accountId)}/matches/${encodeURIComponent(matchId)}/recording`
}

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
      if (!(err instanceof ServerError)) log.error('A write to the server failed', err)

      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }

  /** A read of a route an older server may not have: its 404 is null, anything else still throws. */
  async function orNullIfMissing<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read()
    } catch (err) {
      if (err instanceof ServerError && err.status === 404) return null
      throw err
    }
  }

  const editable = (accountId: string, queueType: QueueType): Promise<EditableMatch[]> =>
    request<EditableMatch[]>(`/riot-accounts/${accountId}/rank/editable?queueType=${queueType}`)

  /**
   * One page of an import, answered in all four counts.
   *
   * Filled in where a server leaves one out, so nothing downstream has to
   * wonder: one that predates `unplaced` counted those as skipped, and one that
   * predates counting at all sent only what it accepted.
   */
  const importBatch = async (path: string, rows: unknown[]): Promise<ImportBatchOutcome> => {
    const answer = await request<Partial<ImportBatchOutcome> & { accepted: number }>(path, {
      method: 'POST',
      body: rows
    })

    return {
      accepted: answer.accepted,
      skipped: answer.skipped ?? 0,
      failed: answer.failed ?? 0,
      unplaced: answer.unplaced ?? 0
    }
  }

  /** A read the server answers with a 404 when there is nothing to answer with. */
  const orNull = async <T>(path: string): Promise<T | null> => {
    try {
      return await request<T>(path)
    } catch (err) {
      if (err instanceof ServerError && err.status === 404) return null
      throw err
    }
  }

  return {
    accounts: {
      /** The accounts the signed-in member has claimed. */
      mine: () => request<Account[]>('/riot-accounts/mine'),

      get: (accountId: string) => orNull<Account>(`/riot-accounts/${encodeURIComponent(accountId)}`),

      find: (riotId: RiotIdInput) =>
        orNull<Account>(
          `/riot-accounts/lookup?gameName=${encodeURIComponent(riotId.gameName)}`
            + `&tagLine=${encodeURIComponent(riotId.tagLine)}`
        ),

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

        return request<Page<ServerMatchSummary>>(`/riot-accounts/${accountId}/matches?${query}`)
      },

      matchDetail: (matchId: string) =>
        request<MatchDetail | null>(`/matches/${encodeURIComponent(matchId)}`),

      /**
       * One game as one player's row: the same summary their history shows,
       * LP chip included. Null when the server holds no such game for them —
       * a link to a game can outlive the account it named.
       */
      matchSummary: async (accountId: string, matchId: string): Promise<ServerMatchSummary | null> => {
        try {
          return await request<ServerMatchSummary>(
            `/riot-accounts/${accountId}/matches/${encodeURIComponent(matchId)}`
          )
        } catch (err) {
          if (err instanceof ServerError && err.status === 404) return null
          throw err
        }
      }
    },

    sync: {
      start: (accountId: string) => attempt(() => request<void>(`/sync/${accountId}`, { method: 'POST' })),
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

      trend: (accountId: string, queueType: QueueType) =>
        request<RankTrend>(`/riot-accounts/${accountId}/rank/trend?queueType=${queueType}`),

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
      players: (query: string, options: PlayerSearchOptions = {}) => {
        let path = `/search?q=${encodeURIComponent(query)}`
        if (options.mine) path += '&mine=true'
        if (options.claimed) path += '&claimed=true'
        if (options.limit !== undefined) path += `&limit=${options.limit}`
        if (options.offset !== undefined) path += `&offset=${options.offset}`
        return request<Page<PlayerSearchResult>>(path)
      }
    },

    replays: {
      /** A signed URL for the replay this server holds of a game. Throws when it holds none. */
      downloadGrant: (matchId: string) =>
        request<ReplayDownloadGrant>(`/replays/${encodeURIComponent(matchId)}/download`)
    },

    /**
     * One account's YouTube recording of one game.
     *
     * The path names both, because the recording is that player's screen and
     * nobody else's — the same game on somebody else's history is a different
     * address with a different answer.
     */
    matchRecordings: {
      /** Null when that player's view of that game is not on YouTube. */
      get: async (accountId: string, matchId: string): Promise<MatchRecording | null> => {
        try {
          return await request<MatchRecording>(recordingPath(accountId, matchId))
        } catch (err) {
          if (err instanceof ServerError && err.status === 404) return null
          throw err
        }
      },

      /**
       * Attaches a video to the game, as its account's owner.
       *
       * A game that already has one answers `exists` rather than failing, so the
       * screen can ask whether to replace it and send again with `replace` set.
       */
      attach: async (
        accountId: string,
        matchId: string,
        input: AttachRecordingInput
      ): Promise<AttachRecordingOutcome> => {
        try {
          await request<MatchRecording>(recordingPath(accountId, matchId), {
            method: 'PUT',
            body: input
          })
          return { ok: true }
        } catch (err) {
          if (!(err instanceof ServerError)) log.error('Attaching a recording failed', err)
          const message = err instanceof Error ? err.message : String(err)
          if (err instanceof ServerError && err.code === 'recording_exists') {
            return { ok: false, reason: 'exists', message }
          }
          return { ok: false, reason: 'failed', message }
        }
      },

      /** Takes the recording off the game. The video itself stays on YouTube. */
      detach: (accountId: string, matchId: string) =>
        attempt(() => request<void>(recordingPath(accountId, matchId), { method: 'DELETE' }))
    },

    admin: {
      storage: () => request<ServerStorageUsage>('/admin/storage/'),

      /** A page of the shared replays, biggest first, so space can be reclaimed where it actually is. */
      storedReplays: (page: PageOptions = {}) =>
        request<Page<AdminReplay>>(
          withQuery('/admin/storage/replays', { limit: page.limit, offset: page.offset })
        ),

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

      /**
       * Starts tracking an account nobody has claimed. Throws rather than
       * answering with a result, because the caller wants the account back.
       */
      addRiotAccount: (input: RiotIdInput) =>
        request<Account>('/admin/riot-accounts', { method: 'POST', body: input }),

      /** A page of the members, by name, narrowed to a name or address when `q` says one. */
      users: (query: AdminUserQuery = {}) =>
        request<Page<AdminUser>>(
          withQuery('/admin/users/', { q: query.q?.trim(), limit: query.limit, offset: query.offset })
        ),

      updateUser: (id: string, patch: AdminUserPatch) =>
        attempt(() =>
          request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
        ),

      deleteUser: (id: string) =>
        attempt(() => request<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' })),

      /**
       * Makes a link that lets somebody set a new password, replacing whatever
       * was outstanding for them.
       *
       * Throws rather than answering with a result, like createInvite and for
       * the same reason: what the caller wants is the link, and there is
       * nothing to show if there is not one.
       */
      createPasswordReset: (userId: string) =>
        request<AdminPasswordReset>(
          `/admin/users/${encodeURIComponent(userId)}/password-reset`,
          { method: 'POST' }
        ),

      /** Withdraws the link outstanding for somebody, if there is one. */
      revokePasswordReset: (userId: string) =>
        attempt(() =>
          request<void>(`/admin/users/${encodeURIComponent(userId)}/password-reset`, {
            method: 'DELETE'
          })
        ),

      /** Every invite that can still be used. Whole: they expire, so there are never many. */
      openInvites: () => request<AdminInvite[]>('/admin/invites/'),

      /** A page of the invites somebody registered with, most recently used first. */
      usedInvites: (page: PageOptions = {}) =>
        request<Page<AdminInvite>>(
          withQuery('/admin/invites/used', { limit: page.limit, offset: page.offset })
        ),

      /**
       * Creates an invite. Without an address it is a link for whoever opens it
       * first, and every call makes a new one.
       *
       * With an address, the server hands back the invite already outstanding
       * for it, if there is one. An admin who cannot remember whether they
       * already made one gets the same link rather than a second one that
       * quietly does nothing.
       */
      createInvite: (email?: string) =>
        request<AdminInvite>('/admin/invites/', { method: 'POST', body: { email: email?.trim() || null } }),

      revokeInvite: (id: string) =>
        attempt(() => request<void>(`/admin/invites/${encodeURIComponent(id)}`, { method: 'DELETE' })),

      getSettings: () => request<ServerAdminSettings>('/admin/settings/'),

      setSettings: (patch: Partial<ServerAdminSettings>) =>
        request<ServerAdminSettings>('/admin/settings/', { method: 'PATCH', body: patch }),

      /**
       * One tab of the insights page, over a window.
       *
       * Null from a server too old to have insights, which answers the route
       * with its JSON 404. A desktop can be newer than the server it is signed
       * in to, and the page should say to update the server rather than fail.
       * Only a desktop can meet one: the web client is always served by the
       * server it talks to.
       */
      insights: <S extends InsightsSection>(section: S, window: InsightsWindow) =>
        orNullIfMissing(() =>
          request<InsightsSections[S]>(withQuery(`/admin/insights/${section}`, { window }))
        ),

      /** A page of the server's recent log lines, newest first. Null from a server too old to keep them. */
      serverLogs: (query: ServerLogQuery = {}) =>
        orNullIfMissing(() =>
          request<Page<ServerLogEntry>>(
            withQuery('/admin/insights/logs', {
              level: query.level,
              limit: query.limit,
              offset: query.offset,
              before: query.before
            })
          )
        )
    },

    /** The endpoints an old stats.db is pushed through. See import/statsDbImporter. */
    importer: {
      accounts: (rows: ImportAccountRow[]) =>
        request<ImportAccountResult[]>('/admin/import/accounts', { method: 'POST', body: rows }),

      seasons: (rows: ImportSeasonRow[]) => importBatch('/admin/import/seasons', rows),

      /**
       * Which of these game ids the server has never stored.
       *
       * Null from a server too old to have the route, which answers an unknown
       * one with a 404 — and that is an answer rather than a failure: the caller
       * sends everything instead, and the matches batch skips what is there.
       */
      unstoredMatches: async (matchIds: string[]): Promise<string[] | null> => {
        try {
          return await request<string[]>('/admin/import/unstored-matches', {
            method: 'POST',
            body: matchIds
          })
        } catch (err) {
          if (err instanceof ServerError && (err.status === 404 || err.status === 405)) return null
          throw err
        }
      },

      matches: (rows: ImportMatchRow[]) => importBatch('/admin/import/matches', rows),

      rankReadings: (rows: ImportReadingRow[]) => importBatch('/admin/import/rank-readings', rows),

      finish: () =>
        request<{ accounts: number; attributed: number }>('/admin/import/finish', { method: 'POST' })
    }
  }
}

export type ServerApi = ReturnType<typeof createServerApi>
