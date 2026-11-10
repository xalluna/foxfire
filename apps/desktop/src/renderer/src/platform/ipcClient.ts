import { GAME_IDS, type ConnectionState, type FoxfireClient } from '@foxfire/core'
import type { Api } from '@shared/api'
import type { ServerState } from '@shared/types'

/**
 * The desktop's FoxfireClient: `window.api`, as the shared screens read it.
 *
 * Almost a rename. The data namespaces are already typed from FoxfireData, so
 * they pass straight through; what is shaped here is the connection — the
 * desktop's own server state, reduced to what a screen needs to know — and the
 * events, which the main process delivers on channels that predate the
 * contract.
 *
 * The main process still decides where every answer comes from, local SQLite
 * or a server, per call. Nothing here can tell, and nothing here needs to.
 */
export function createIpcClient(api: Api): FoxfireClient {
  return {
    connection: {
      get: async () => connectionFrom(await api.server.getState()),
      onChanged: (cb) => api.server.onChanged((state) => cb(connectionFrom(state)))
    },

    accounts: {
      mine: api.accounts.mine,
      get: api.accounts.get,
      find: api.accounts.find,
      getHome: api.accounts.getHome,
      remove: api.accounts.remove,
      setHome: api.accounts.setHome
    },

    dashboard: api.dashboard,

    sync: {
      start: api.sync.start,
      getState: api.sync.getState
    },

    champions: api.champions,
    mastery: api.mastery,

    rank: {
      history: api.rank.history,
      trend: api.rank.trend,
      periods: api.rank.periods,
      editable: api.rank.editable,
      saveManual: api.rank.saveManual,
      clearManual: api.rank.clearManual
    },

    seasons: api.seasons,
    tft: api.tft,
    search: api.search,
    favorites: api.favorites,

    // Answered by the server when connected to one; local-only has none, and
    // says so rather than pretending. Uploading is not the screens' to do
    // here — the main process has the file and runs the queue — so the
    // platform's uploadRecording is the way in, and this refuses.
    matchRecordings: {
      get: api.matchRecordings.get,
      embed: api.matchRecordings.embed,
      remove: api.matchRecordings.remove,
      upload: async () => ({
        ok: false,
        reason: 'failed',
        message: 'Recordings are uploaded from the Recordings tab, where their files are.'
      })
    },
    assets: api.assets,

    account: {
      email: api.server.accountEmail,
      resendEmailConfirmation: api.server.resendEmailConfirmation,
      cancelEmailChange: api.server.cancelEmailChange
    },

    shares: {
      create: api.server.createShareLink,
      revoke: api.server.revokeShareLink
    },

    admin: {
      users: api.serverAdmin.users,
      updateUser: api.serverAdmin.updateUser,
      deleteUser: api.serverAdmin.deleteUser,
      createPasswordReset: api.serverAdmin.createPasswordReset,
      revokePasswordReset: api.serverAdmin.revokePasswordReset,
      openInvites: api.serverAdmin.openInvites,
      usedInvites: api.serverAdmin.usedInvites,
      createInvite: api.serverAdmin.createInvite,
      revokeInvite: api.serverAdmin.revokeInvite,
      emailInvite: api.serverAdmin.emailInvite,
      getSettings: api.serverAdmin.getSettings,
      setSettings: api.serverAdmin.setSettings,
      shareLinks: api.serverAdmin.shareLinks,
      storage: api.serverAdmin.storage,
      storedReplays: api.serverAdmin.storedReplays,
      removeReplay: api.serverAdmin.removeReplay,
      forceUnlink: api.serverAdmin.forceUnlink,
      addRiotAccount: api.serverAdmin.addRiotAccount,
      insights: api.serverAdmin.insights,
      serverLogs: api.serverAdmin.serverLogs,
      emailOverview: api.serverAdmin.emailOverview,
      emailLog: api.serverAdmin.emailLog,
      emailSuppressions: api.serverAdmin.emailSuppressions,
      clearEmailSuppression: api.serverAdmin.clearEmailSuppression,
      sendTestEmail: api.serverAdmin.sendTestEmail
    },

    events: {
      onSyncProgress: api.sync.onProgress,
      onRankEdited: api.rank.onEdited,
      onRankChanged: api.lcu.onRankChanged,
      onRecordingChanged: api.matchRecordings.onChanged
    }
  }
}

/**
 * The desktop's server state, as a screen needs it.
 *
 * Server mode is a signed-in session and not merely a configured server — the
 * same rule the main process reads by. One that is known but signed out of is
 * a row on the Settings page, and everything reads locally until then.
 */
export function connectionFrom(state: ServerState): ConnectionState {
  const connected = state.activeUrl !== null && state.session !== null
  const active = state.servers.find((server) => server.isActive)

  return {
    mode: connected ? 'server' : 'local',
    // The address the server says it is reached at, never the one this machine
    // connected with — that may be a LAN name nobody the link is sent to could
    // open. Null from a server too old to say, which hides "Copy link".
    publicUrl: connected ? state.publicUrl : null,
    serverName: connected ? (active?.name ?? null) : null,
    session: state.session
      ? {
          username: state.session.username,
          email: state.session.email,
          isAdmin: state.session.isAdmin,
          isHeadAdmin: state.session.isHeadAdmin
        }
      : null,
    publicAccess: connected ? state.publicAccess : false,
    // The server's to say while reading from it; local-only, this machine's
    // own key decides what it can reach, and every game is offered.
    games: connected ? state.games : [...GAME_IDS],
    recordings: connected && state.recordings,
    riotKeyRejected: state.riotKeyRejected,
    upgradeRequired: state.upgradeRequired
  }
}
