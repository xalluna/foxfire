import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface LcuCredentials {
  port: number
  /** The client's per-session password; used as the HTTP basic password. */
  token: string
}

/**
 * Where the running League client is listening.
 *
 * The client picks a random port each launch and prints the credentials in two
 * places: its own command line, and a `lockfile` in the install directory.
 * Process arguments are tried first because they work regardless of where
 * League was installed, which the lockfile path cannot without being told.
 */
export async function discoverLcu(manualPath: string | null): Promise<LcuCredentials | null> {
  return (await fromProcess()) ?? fromLockfile(manualPath)
}

const PORT_ARG = /--app-port=(\d+)/
const TOKEN_ARG = /--remoting-auth-token=([\w-]+)/

async function fromProcess(): Promise<LcuCredentials | null> {
  if (process.platform !== 'win32') return null

  try {
    // -NoProfile keeps a user's PowerShell profile from writing to stdout and
    // corrupting the output we parse.
    const { stdout } = await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine"
      ],
      { timeout: 5000, windowsHide: true }
    )

    const port = stdout.match(PORT_ARG)?.[1]
    const token = stdout.match(TOKEN_ARG)?.[1]
    if (!port || !token) return null

    return { port: Number(port), token }
  } catch {
    // No client running, PowerShell unavailable, or the query timed out — the
    // lockfile is tried next, and a miss simply means "not connected".
    return null
  }
}

const DEFAULT_INSTALL = 'C:\\Riot Games\\League of Legends'

/** Lockfile format: `LeagueClient:PID:PORT:PASSWORD:PROTOCOL`. */
function fromLockfile(manualPath: string | null): LcuCredentials | null {
  const candidates = manualPath ? [manualPath, DEFAULT_INSTALL] : [DEFAULT_INSTALL]

  for (const dir of candidates) {
    try {
      // Accept either the install directory or a full path to the lockfile,
      // since it is easy to paste either into the settings field.
      const path = dir.toLowerCase().endsWith('lockfile') ? dir : join(dir, 'lockfile')
      const parts = readFileSync(path, 'utf8').trim().split(':')
      if (parts.length < 5) continue

      const port = Number(parts[2])
      if (!Number.isFinite(port) || !parts[3]) continue

      return { port, token: parts[3] }
    } catch {
      // Wrong directory or the client is closed; try the next candidate.
    }
  }

  return null
}
