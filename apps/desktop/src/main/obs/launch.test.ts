import { createServer, type Server } from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Whether OBS is launched — never beside one that is already running, whether
 * or not its websocket has come up yet.
 *
 * The port is real: a server on a free one, or a port nothing holds. The
 * process list and the launch itself are stubbed.
 */

const fake = vi.hoisted(() => ({
  /** What tasklist prints; null makes the query fail. */
  tasklist: null as string | null,
  tasklistCalls: 0,
  spawned: [] as string[]
}))

vi.mock('../telemetry/logger', () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} })
}))

// Every candidate exists, so the first default install path is the one chosen.
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: () => true
}))

vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    _args: string[],
    _options: unknown,
    cb: (err: Error | null, stdout: string) => void
  ) => {
    fake.tasklistCalls++
    if (fake.tasklist === null) cb(new Error('tasklist failed'), '')
    else cb(null, fake.tasklist)
  },
  spawn: (exe: string) => {
    fake.spawned.push(exe)
    return { exitCode: null, unref: () => {}, on: () => {}, kill: () => {} }
  }
}))

const OBS_RUNNING = '"obs64.exe","28208","Console","1","174,352 K"\r\n'
const NO_OBS = 'INFO: No tasks are running which match the specified criteria.\r\n'

type Launch = typeof import('./launch')

async function load(): Promise<Launch> {
  vi.resetModules()
  return import('./launch')
}

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}

/** A port that was free a moment ago and has nothing on it now. */
async function closedPort(): Promise<number> {
  const server = createServer()
  const port = await listen(server)
  await close(server)
  return port
}

beforeEach(() => {
  fake.tasklist = null
  fake.tasklistCalls = 0
  fake.spawned = []
})

describe('launching OBS', () => {
  let websocket: Server | null = null

  afterEach(async () => {
    if (websocket) await close(websocket)
    websocket = null
  })

  it('connects to an OBS that is running but not listening yet', async () => {
    const { launchObs } = await load()
    fake.tasklist = OBS_RUNNING

    await launchObs(null, '127.0.0.1', await closedPort())

    expect(fake.spawned).toEqual([])
  })

  it('leaves an OBS that is listening alone, without reading the process list', async () => {
    const { launchObs } = await load()
    websocket = createServer()
    const port = await listen(websocket)

    await launchObs(null, '127.0.0.1', port)

    expect(fake.spawned).toEqual([])
    expect(fake.tasklistCalls).toBe(0)
  })

  it('launches one when there is no OBS at all', async () => {
    const { launchObs } = await load()
    fake.tasklist = NO_OBS

    await launchObs(null, '127.0.0.1', await closedPort())

    expect(fake.spawned).toEqual(['C:\\Program Files\\obs-studio\\bin\\64bit\\obs64.exe'])
  })

  it('still launches when the process list cannot be read', async () => {
    const { launchObs } = await load()
    fake.tasklist = null

    await launchObs(null, '127.0.0.1', await closedPort())

    expect(fake.spawned).toHaveLength(1)
  })

  it('launches once when asked twice at the same time', async () => {
    const { launchObs } = await load()
    fake.tasklist = NO_OBS
    const port = await closedPort()

    // Startup and a settings change landing together, which is what boot sees.
    await Promise.all([launchObs(null, '127.0.0.1', port), launchObs(null, '127.0.0.1', port)])
    // And again once it is up: the one it started is still running.
    await launchObs(null, '127.0.0.1', port)

    expect(fake.spawned).toHaveLength(1)
  })
})
