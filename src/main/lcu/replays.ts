import { lcuGet, lcuPost } from './client'
import { createLogger } from '../telemetry/logger'
import type { LcuCredentials } from './discovery'

/**
 * The things only the running League client can do about replays.
 *
 * Two of these are reads and one is the "play this" the whole feature exists
 * for. Foxfire never asks the client to download anything and never changes the
 * user's League settings — it watches the folder the client writes into, takes
 * what appears, and hands a replay back when asked.
 *
 * Every failure here is ordinary. The client is closed most of the time, and
 * these endpoints are undocumented and have moved before. Nothing here throws:
 * the reads fall back to a default that is right for almost everyone, and the
 * play attempt reports whether it landed so the caller can say so.
 */

const log = createLogger('rofl')

/**
 * Where the client writes .rofl files.
 *
 * Configurable inside League, which is the only reason this call exists: the
 * default is under Documents, but anybody who moved it would otherwise get an
 * app that watches an empty folder forever and never says why.
 */
export async function fetchReplayFolder(creds: LcuCredentials): Promise<string | null> {
  try {
    // Returns a bare JSON string, not an object.
    const path = await lcuGet<unknown>(creds, '/lol-replays/v1/rofls/path')
    return typeof path === 'string' && path.trim() !== '' ? path : null
  } catch (err) {
    log.debug('Could not read the replay folder from the client', { error: String(err) })
    return null
  }
}

/**
 * Whether the client is set to keep replays at all.
 *
 * This is the feature's single point of silent failure. If the user has replay
 * recording switched off in League, no .rofl is ever written, the watcher sees
 * nothing, and every part of Foxfire behaves correctly while appearing broken.
 * Knowing the answer turns that into one sentence in Settings.
 *
 * Null means "the client was not running to ask", which is different from "off"
 * and must not be reported as a problem.
 */
export async function fetchAutoRecordEnabled(creds: LcuCredentials): Promise<boolean | null> {
  try {
    const config = await lcuGet<Record<string, unknown>>(creds, '/lol-replays/v1/configuration')

    // The flag has been spelled more than one way across client versions. Take
    // the first one present rather than pinning to a name that may move again;
    // a wrong guess here would nag a user whose setup is fine.
    for (const key of ['isRoflsEnabled', 'isReplaysEnabled', 'enabled']) {
      const value = config[key]
      if (typeof value === 'boolean') return value
    }
    return null
  } catch (err) {
    log.debug('Could not read the replay configuration from the client', { error: String(err) })
    return null
  }
}

/**
 * Whether the client is holding this replay and considers it playable.
 *
 * `state` is the useful field: "watch" means the file is downloaded and ready.
 * Anything else — or a 404 — means asking it to play would fail, and it is
 * better to restore our own copy into its folder first.
 */
export async function fetchReplayState(
  creds: LcuCredentials,
  gameId: string
): Promise<string | null> {
  try {
    const meta = await lcuGet<Record<string, unknown>>(creds, `/lol-replays/v1/metadata/${gameId}`)
    const state = meta['state']
    return typeof state === 'string' ? state : null
  } catch {
    // A replay the client has never heard of 404s here, which is ordinary.
    return null
  }
}

/**
 * Asks the League client to play a replay.
 *
 * This, not the file association, is how a .rofl actually gets watched. The
 * association is registered by the Riot Client only sometimes — on a machine
 * where it is missing, handing the file to the shell produces Windows' "select
 * an app" dialog, which is worse than useless. The client already knows how to
 * play its own replays, and this is the route its own match history uses.
 *
 * Keyed on the game id, not a path: the client plays out of its own replay
 * folder, so the file has to be there. It normally is, since that is where
 * Foxfire copied it from.
 *
 * `componentType` is the client's own analytics tag for which button was
 * pressed. It is required and its value is not otherwise meaningful.
 */
export async function watchReplay(creds: LcuCredentials, gameId: string): Promise<boolean> {
  try {
    await lcuPost(creds, `/lol-replays/v1/rofls/${gameId}/watch`, {
      componentType: 'replay-button_match-history'
    })
    log.info('Asked the League client to play a replay', { gameId })
    return true
  } catch (err) {
    log.warn('The League client refused to play a replay', { gameId, error: String(err) })
    return false
  }
}
