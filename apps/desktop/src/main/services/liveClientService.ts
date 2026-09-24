import { serverBacked } from '../api'
import { isNotRunning, liveClientGet } from '../liveClient/client'
import { AllGameDataSchema } from '../liveClient/types'
import { toScoreboard } from '../liveClient/scoreboardMapping'
import { getAssetManifest } from './ddragonService'
import type { Scoreboard } from '@shared/types'

/**
 * Reads the scoreboard out of the game running on this machine.
 *
 * Returns null whenever there is no game — which is most of the time, and is
 * not a failure. Nothing listens on the port outside a match, so a refused
 * connection is the ordinary answer to "is a game on?" and the screen renders
 * it as an empty board rather than an error.
 *
 * Costs no Riot API calls at all: the game is the source, and the only thing
 * fetched alongside is the Data Dragon manifest, already cached for the life of
 * the process.
 */
export async function getScoreboard(accountId: string): Promise<Scoreboard | null> {
  // Through whichever store owns accounts rather than straight to SQLite,
  // because the board is matched by Riot ID and in server mode the account
  // that owns it is on the server.
  const account = await serverBacked().accounts.get(accountId)
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
  // never actually observed. Kept anyway, because a board of nought rows is
  // not worth drawing whatever produces it.
  if (!data.allPlayers || data.allPlayers.length === 0) return null

  return toScoreboard(data, await getAssetManifest(), `${account.gameName}#${account.tagLine}`)
}

