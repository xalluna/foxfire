import { Agent } from 'node:https'

/**
 * Both local Riot services — the League client's own API and the Live Client
 * Data API the running game serves on 2999 — sit behind self-signed
 * certificates that no trust store will ever accept, so verification has to be
 * off for either connection to succeed at all.
 *
 * Scoped deliberately to this one agent rather than set globally: every other
 * request the app makes — Riot's API, Data Dragon — keeps full verification.
 * The blast radius is loopback, which is not reachable off the machine.
 */
export const loopbackAgent = new Agent({ rejectUnauthorized: false, keepAlive: true })
