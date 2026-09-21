import type { ConnectionState, FoxfireClient } from '@foxfire/core'
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
      list: api.accounts.list,
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
      periods: api.rank.periods,
      editable: api.rank.editable,
      saveManual: api.rank.saveManual,
      clearManual: api.rank.clearManual
    },

    seasons: api.seasons,
    search: api.search,
    assets: api.assets,

    admin: {
      users: api.serverAdmin.users,
      updateUser: api.serverAdmin.updateUser,
      deleteUser: api.serverAdmin.deleteUser,
      invites: api.serverAdmin.invites,
      createInvite: api.serverAdmin.createInvite,
      revokeInvite: api.serverAdmin.revokeInvite,
      getSettings: api.serverAdmin.getSettings,
      setSettings: api.serverAdmin.setSettings,
      storage: api.serverAdmin.storage,
      storedReplays: api.serverAdmin.storedReplays,
      removeReplay: api.serverAdmin.removeReplay,
      forceUnlink: api.serverAdmin.forceUnlink
    },

    events: {
      onSyncProgress: api.sync.onProgress,
      onRankEdited: api.rank.onEdited,
      onRankChanged: api.lcu.onRankChanged
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
    // Not the address this machine connected with, which may be a LAN name
    // nobody else can reach. Filled in once the server says what it is.
    publicUrl: null,
    serverName: connected ? (active?.name ?? null) : null,
    session: state.session
      ? {
          username: state.session.username,
          email: state.session.email,
          isAdmin: state.session.isAdmin
        }
      : null,
    riotKeyRejected: state.riotKeyRejected,
    upgradeRequired: state.upgradeRequired
  }
}
