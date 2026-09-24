import type { Api } from '@shared/api'

/**
 * The half of the renderer's contract whose answers come from the shared store.
 *
 * Foxfire reads its data from one of two places. In local-only mode it is this
 * machine's SQLite file, filled by this process talking to Riot. Connected to a
 * Foxfire Server it is that server's database, filled by the server talking to
 * Riot on one key for everybody. The renderer must not be able to tell which:
 * it calls `window.api` either way, and the choice is made once, here in main.
 *
 * So these namespaces are named as a type rather than left implicit in a pile
 * of ipcMain.handle callbacks. Two implementations have to satisfy exactly this
 * shape and stay interchangeable, and the compiler is a better guarantee of
 * that than a careful reading of a 400-line file.
 *
 * Every member is projected out of `Api` rather than restated, so the two
 * cannot drift: widening a method there is a compile error here until both
 * implementations answer for it.
 *
 * What is deliberately NOT here:
 *
 *   - `settings` — the Riot API key, its type and its rate limits. Connected to
 *     a server this machine holds no key at all; the server does. It is config
 *     for local-only mode, not data from anywhere.
 *   - `assets` — Data Dragon. A public CDN that needs no key and is not rate
 *     limited, so there is nothing to be gained by routing it through a server.
 *   - `liveClient`, `lcu`, `capture`, `recordings`, `replays`, `archives`,
 *     `background`, `telemetry`, `pathForFile` — the machine's own business.
 *     A game running on this PC, an OBS on this PC, files on this disk.
 *   - The event subscriptions and window-opening calls stripped from `sync` and
 *     `rank` below. Those are renderer plumbing, identical in both modes: a
 *     BrowserWindow is opened by this process whatever is answering its reads.
 */
export interface ServerBackedApi {
  accounts: Api['accounts']
  dashboard: Api['dashboard']
  matchRecordings: Omit<Api['matchRecordings'], 'onChanged'>
  sync: Omit<Api['sync'], 'onProgress'>
  champions: Api['champions']
  mastery: Api['mastery']
  rank: Omit<Api['rank'], 'openEditor' | 'onEdited' | 'onEditorFocus'>
  seasons: Api['seasons']
  search: Api['search']
}
