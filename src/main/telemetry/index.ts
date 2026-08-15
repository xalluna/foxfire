import { randomBytes } from 'node:crypto'
import { statSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import { getDb } from '../db'
import { getBoolSetting, setBoolSetting } from '../db/repositories/appSettings.repo'
import {
  closeTelemetryDb,
  getMeta,
  openTelemetryDb,
  peekTelemetryDb,
  setMeta,
  telemetryDbPath
} from './db'
import { setHashSalt } from './redact'
import { droppedCount, enqueue, flush, flushIfDue, pendingCount, startWriter, stopWriter } from './writer'
import type { LcuEventRow, ResourceSampleRow, RiotRequestRow, SpanRow } from './types'
import type { TelemetryState } from '@shared/telemetry'

/**
 * Public surface of the telemetry subsystem.
 *
 * Always compiled into the app, dormant unless switched on in Settings. The
 * record* functions below are called from measured paths, so the disabled case
 * has to be a single boolean check and nothing else — no allocation, no date
 * lookup, no database handle.
 *
 * Reads are deliberately *not* gated on the same flag: turning collection off
 * should stop new rows appearing, not make the history you already gathered
 * unreadable in the panel.
 */

export const TELEMETRY_ENABLED_KEY = 'telemetry.enabled'
const SALT_META_KEY = 'hash.salt'

let enabled = false

/** Reads the persisted preference and starts collection if it was left on. */
export function initTelemetry(): void {
  const persisted = getBoolSetting(getDb(), TELEMETRY_ENABLED_KEY, false)
  if (persisted) enable()
}

export function isTelemetryEnabled(): boolean {
  return enabled
}

/**
 * Hot toggle — no restart.
 *
 * Enabling opens (and on first ever use, creates and migrates) telemetry.db,
 * which is why a user who never turns this on never gets the file at all.
 */
export function setTelemetryEnabled(next: boolean): void {
  setBoolSetting(getDb(), TELEMETRY_ENABLED_KEY, next)
  if (next) enable()
  else disable()
}

function enable(): void {
  if (enabled) return
  const db = openTelemetryDb()
  ensureSalt(db)
  startWriter(() => peekTelemetryDb())
  enabled = true
}

function disable(): void {
  if (!enabled) return
  enabled = false
  stopWriter()
  // Commit whatever was already collected rather than discarding it — the user
  // turned collection off, not the last few seconds of history.
  const db = peekTelemetryDb()
  if (db) flush(db)
}

/**
 * A random per-install salt for identifier hashing, generated once and kept in
 * telemetry.db. Wiping the file regenerates it, which only means hashes stop
 * matching across the wipe — they are only ever compared within one dataset.
 */
function ensureSalt(db: DatabaseSync): void {
  let salt = getMeta(db, SALT_META_KEY)
  if (!salt) {
    salt = randomBytes(16).toString('hex')
    setMeta(db, SALT_META_KEY, salt)
  }
  setHashSalt(salt)
}

export function getTelemetryState(): TelemetryState {
  const db = peekTelemetryDb()
  return {
    enabled,
    dbPath: telemetryDbPath(),
    pending: pendingCount(),
    dropped: droppedCount() + persistedDropped(db),
    dbBytes: fileSize(telemetryDbPath())
  }
}

function persistedDropped(db: DatabaseSync | null): number {
  if (!db) return 0
  const raw = getMeta(db, 'writer.dropped')
  return raw ? Number(raw) : 0
}

function fileSize(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    // Not an error: the file does not exist until telemetry is first enabled.
    return null
  }
}

/**
 * Opens the database for reading regardless of whether collection is on, so the
 * panel can show history after the toggle has been switched off.
 */
export function telemetryDbForRead(): DatabaseSync {
  const db = openTelemetryDb()
  ensureSalt(db)
  return db
}

export function recordRiotRequest(row: RiotRequestRow): void {
  if (!enabled) return
  enqueue({ table: 'riot_requests', row })
  flushIfDue(peekTelemetryDb())
}

export function recordResourceSample(row: ResourceSampleRow): void {
  if (!enabled) return
  enqueue({ table: 'resource_samples', row })
  flushIfDue(peekTelemetryDb())
}

export function recordSpan(row: SpanRow): void {
  if (!enabled) return
  enqueue({ table: 'spans', row })
  // Root spans force a commit: a sync run finishing is exactly the moment worth
  // having on disk, rather than whenever the timer next happens to fire.
  flushIfDue(peekTelemetryDb(), row.parentId === null)
}

export function recordLcuEvent(row: LcuEventRow): void {
  if (!enabled) return
  enqueue({ table: 'lcu_events', row })
  flushIfDue(peekTelemetryDb())
}

/** Final flush on quit, wired into the existing will-quit handler. */
export function shutdownTelemetry(): void {
  stopWriter()
  const db = peekTelemetryDb()
  if (db) {
    flush(db)
    closeTelemetryDb()
  }
  enabled = false
}
