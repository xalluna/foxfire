import type { GameId } from '@foxfire/core'

/**
 * The window each game is played in, for whichever recorder is capturing it.
 *
 * The two are different programs: League's game is `League of Legends.exe`,
 * and TFT's is Riot's own Unreal client. The game window, not the League
 * client: the client is a separate process, and capturing it would record the
 * post-game screen and nothing else.
 *
 * OBS matches on all three at once (its "title:class:executable" spec), and the
 * native recorder on the executable and class. The title is the weakest of the
 * three — League's carries a trademark symbol that has moved between patches,
 * and the process name has not — so nothing matches on it alone.
 */
export interface GameWindow {
  title: string
  windowClass: string
  exe: string
}

export const GAME_WINDOWS: Record<GameId, GameWindow> = {
  lol: {
    title: 'League of Legends (TM) Client',
    windowClass: 'RiotWindowClass',
    exe: 'League of Legends.exe'
  },
  tft: {
    title: 'Teamfight Tactics',
    windowClass: 'UnrealWindow',
    exe: 'TFTClient-Win64-Shipping.exe'
  }
}

/** OBS's own window spec for a game: "title:class:executable". */
export function obsWindowSpec(window: GameWindow): string {
  return `${window.title}:${window.windowClass}:${window.exe}`
}
