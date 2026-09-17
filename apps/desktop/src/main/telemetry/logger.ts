import { createWriteStream, mkdirSync, renameSync, rmSync, statSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { is } from '../lib/env'
import { isTelemetryEnabled } from './index'
import { redact, scrubString } from './redact'

/**
 * Structured logging for the main process.
 *
 * Before this the app had two console.error calls and nothing else, so a
 * failure in tray mode — where nobody is watching a terminal — left no trace at
 * all. Lines go to a rotating JSONL file, and additionally to stdout in a
 * readable form during `npm run dev`.
 *
 * Level gating is deliberately asymmetric: warn and error are always written,
 * because those are the lines you need after something has already gone wrong,
 * while the chattier levels only appear once telemetry is switched on. Leaving
 * telemetry off therefore costs nothing but still leaves a trail.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error'

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50
}

/** Written whatever the settings say. */
const ALWAYS_LEVEL = LEVEL_RANK.warn

const MAX_FILE_BYTES = 5 * 1024 * 1024
/** app.log plus app.1.log … app.4.log — a ~25MB ceiling. */
const MAX_FILES = 5

let stream: WriteStream | null = null
let bytesWritten = 0
let sinkFailed = false

export function logDirectory(): string {
  return join(app.getPath('userData'), 'logs')
}

function logPath(index = 0): string {
  return join(logDirectory(), index === 0 ? 'app.log' : `app.${index}.log`)
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function openStream(): WriteStream | null {
  if (sinkFailed) return null
  try {
    mkdirSync(logDirectory(), { recursive: true })
    const path = logPath(0)
    bytesWritten = fileSize(path)
    return createWriteStream(path, { flags: 'a' })
  } catch {
    // A log sink that cannot open must not take the app down with it.
    sinkFailed = true
    return null
  }
}

/**
 * Shifts app.log → app.1.log → … and drops the oldest.
 *
 * Synchronous, and only at the rollover boundary: renaming a handful of files
 * once per 5MB is cheap, and doing it asynchronously would mean deciding what
 * to do with lines written while the shuffle was in flight.
 */
function rotate(): void {
  stream?.end()
  stream = null
  try {
    rmSync(logPath(MAX_FILES - 1), { force: true })
    for (let i = MAX_FILES - 2; i >= 0; i -= 1) {
      const from = logPath(i)
      if (fileSize(from) === 0) continue
      renameSync(from, logPath(i + 1))
    }
  } catch {
    // If rotation fails, carry on with a fresh stream rather than losing the
    // sink entirely.
  }
  stream = openStream()
}

function writeLine(line: string): void {
  if (!stream) stream = openStream()
  if (!stream) return

  const payload = `${line}\n`
  bytesWritten += Buffer.byteLength(payload)
  stream.write(payload)
  if (bytesWritten >= MAX_FILE_BYTES) rotate()
}

// Built from a char code so no literal control character lives in this file.
const ESC = String.fromCharCode(27)
const RESET = ESC + '[0m'
const SCOPE_COLOUR = ESC + '[35m'
const LEVEL_COLOUR: Record<LogLevel, string> = {
  trace: ESC + '[90m',
  debug: ESC + '[36m',
  info: ESC + '[37m',
  warn: ESC + '[33m',
  error: ESC + '[31m'
}

function writeStdout(level: LogLevel, scope: string, message: string, context?: unknown): void {
  const stamp = new Date().toISOString().slice(11, 23)
  const tail = context === undefined ? '' : ` ${JSON.stringify(context)}`
  const head = `${LEVEL_COLOUR[level]}${stamp} ${level.toUpperCase().padEnd(5)}${RESET}`
  // eslint-disable-next-line no-console
  console.log(`${head} ${SCOPE_COLOUR}${scope}${RESET} ${message}${tail}`)
}

function emit(level: LogLevel, scope: string, message: string, context?: unknown): void {
  if (LEVEL_RANK[level] < ALWAYS_LEVEL && !isTelemetryEnabled()) return

  const safeMessage = scrubString(message)
  const safeContext = context === undefined ? undefined : redact(context)

  writeLine(
    JSON.stringify({
      at: new Date().toISOString(),
      level,
      scope,
      message: safeMessage,
      ...(safeContext === undefined ? {} : { context: safeContext })
    })
  )

  if (is.dev) writeStdout(level, scope, safeMessage, safeContext)
}

export interface Logger {
  trace(message: string, context?: unknown): void
  debug(message: string, context?: unknown): void
  info(message: string, context?: unknown): void
  warn(message: string, context?: unknown): void
  /** `error` is a thrown value; it is redacted and folded into the context. */
  error(message: string, error?: unknown, context?: Record<string, unknown>): void
}

export function createLogger(scope: string): Logger {
  return {
    trace: (message, context) => emit('trace', scope, message, context),
    debug: (message, context) => emit('debug', scope, message, context),
    info: (message, context) => emit('info', scope, message, context),
    warn: (message, context) => emit('warn', scope, message, context),
    error: (message, error, context) =>
      emit('error', scope, message, {
        ...(context ?? {}),
        ...(error === undefined ? {} : { error: redact(error) })
      })
  }
}

/**
 * Catches what would otherwise vanish.
 *
 * An unhandled rejection in the main process is silent today, and in tray mode
 * there is no window to notice it in. These handlers deliberately do not exit:
 * the app has survived these conditions until now, and turning a logged warning
 * into a crash would be a behaviour change rather than an improvement.
 */
export function installCrashHandlers(): void {
  const log = createLogger('process')

  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', err)
    flushLogs()
  })

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', reason)
  })
}

export function flushLogs(): void {
  stream?.end()
  stream = null
}
