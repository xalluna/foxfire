import { serverBacked } from '../api'
import { isNotRunning, liveClientGet } from '../liveClient/client'
import { AllGameDataSchema } from '../liveClient/types'
import { toScoreboard, type Scoreboard } from '../liveClient/scoreboardMapping'
import { getAssetManifest } from './ddragonService'

/**
 * Reads who is playing what out of the game running on this machine, for
 * capture: the clock that says when a game is ready to record, the player whose
 * events to keep, and the roster that later finds the recording its match.
 *
 * Returns null whenever there is no game — which is most of the time, and is
 * not a failure. Nothing listens on the port outside a match, so a refused
 * connection is the ordinary answer to "is a game on?", and capture reads it as
 * exactly that.
 *
 * Costs no Riot API calls at all: the game is the source, and the only thing
 * fetched alongside is the Data Dragon manifest, already cached for the life of
 * the process.
 */
export async function getScoreboard(accountId: string): Promise<Scoreboard | null> {
  // Through the account list rather than straight to SQLite, because the board
  // is matched by Riot ID and in server mode the account that owns it is on the
  // server. The list is small and already the app's answer to "who is this".
  const accounts = await serverBacked().accounts.list()
  const account = accounts.find((a) => a.id === accountId)
  if (!account) throw new Error(`Unknown account ${accountId}`)

  let raw: unknown
  try {
    raw = await liveClientGet('/liveclientdata/allgamedata')
  } catch (err) {
    if (isNotRunning(err)) return null
    throw err
  }

  const data = AllGameDataSchema.parse(raw)
  // Belt and braces. Probing a real game showed the port go from refused, to
  // 404 for about three seconds while the game process starts, straight to a
  // full ten-player roster during the loading screen — an empty allPlayers was
  // never actually observed. Kept anyway, because a game with nobody in it is
  // not one worth recording.
  if (!data.allPlayers || data.allPlayers.length === 0) return null

  return toScoreboard(data, await getAssetManifest(), `${account.gameName}#${account.tagLine}`)
}
