/**
 * @foxfire/core — what every Foxfire client agrees on.
 *
 * The League data shapes, the rules over them (ladder arithmetic, seasons,
 * queues, lanes), and the contract a screen reads data through. No React, no
 * Node and no DOM beyond what both a browser and Node provide — this is
 * imported by the desktop's main process, its renderer, and the web client,
 * and has to run in all three.
 *
 * The rest is behind subpaths so a caller pulls in only what it uses:
 * `@foxfire/core/server` (talking to a Foxfire Server, which brings SignalR),
 * `/routes` (link paths), `/ddragon` (the asset manifest) and `/import` (moving
 * an old stats.db onto a server).
 */
export type * from './types'
export type { ConnectionState, FoxfireClient, FoxfireData, Unsubscribe } from './client'
export type { Logger } from './log'
export { silentLogger } from './log'
export * from './rules/ladder'
export * from './rules/seasons'
export * from './rules/queues'
export * from './rules/positions'
