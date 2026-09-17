import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import { shell } from 'electron'
import { createLogger } from '../telemetry/logger'
import { discoverLcu } from '../lcu/discovery'
import { fetchReplayState, watchReplay } from '../lcu/replays'
import { gameExecutable } from './install'
import type { Runner } from './patch'

/**
 * Handing a replay back to Riot.
 *
 * Foxfire builds no player for .rofl files. Riot's already exists, works, and
 * does things a video never could — free camera, fog of war, every player's
 * point of view. Rebuilding it would be a large amount of work to arrive
 * somewhere worse.
 *
 * There are two ways in, and they are not equally certain.
 *
 * For the current patch, the running League client is asked to play the replay
 * over its own local API — the same route its own match history uses. The
 * obvious alternative, handing the file to the shell and letting the .rofl
 * association open it, does not survive contact with a real machine: that
 * association is registered by the Riot Client only sometimes, and where it is
 * missing the user gets Windows' "select an app to open this file" dialog
 * offering them Notepad. Asking the client directly has no such failure mode,
 * and the client is necessarily running anyway, since it is the thing that
 * plays the replay.
 *
 * An archived install has no such route — its client is not the one running,
 * and the live one will refuse a replay from an older patch. The only option is
 * to start that install's game executable ourselves and pass it the file. That
 * invocation is not documented by Riot and is not something this code can
 * promise, so when it fails the user is not left with a button that silently
 * does nothing: the folder is opened and the exact command is reported.
 */

const log = createLogger('rofl')

export type LaunchOutcome =
  | { ok: true; via: 'client' | 'archive' }
  | { ok: false; reason: string; attemptedCommand: string | null }

export interface LaunchRequest {
  /** Foxfire's own copy. */
  filePath: string
  /** The numeric id the client keys its replay routes on. */
  gameId: string | null
  runner: Runner
  /**
   * Puts Foxfire's copy back into Riot's replay folder and resolves with where
   * it went, or null if it could not.
   *
   * The client plays out of its own folder, so a replay it has cleaned up — or
   * one the user only has because Foxfire kept it — has to be put back before
   * it can be watched. This is the moment those copies earn their disk.
   */
  restoreToRiotFolder: () => Promise<string | null>
}

export async function launchReplay(request: LaunchRequest): Promise<LaunchOutcome> {
  return request.runner.isLive ? watchInClient(request) : launchFromArchive(request)
}

/** The supported path: the running client plays its own replay. */
async function watchInClient(request: LaunchRequest): Promise<LaunchOutcome> {
  if (request.gameId === null) {
    return {
      ok: false,
      reason:
        'Foxfire could not work out which game this replay is, so it cannot ask the League client to play it.',
      attemptedCommand: null
    }
  }

  const creds = await discoverLcu(null)
  if (creds === null) {
    return {
      ok: false,
      reason: 'Open the League client and try again — it is what plays replays.',
      attemptedCommand: null
    }
  }

  // "watch" means the client has the file and considers it ready. Anything else
  // means it is not holding one, and ours is put back before asking.
  const state = await fetchReplayState(creds, request.gameId)
  if (state !== 'watch') {
    log.info('The client is not holding this replay; restoring our copy', {
      gameId: request.gameId,
      state
    })
    const restored = await request.restoreToRiotFolder()
    if (restored === null) {
      return {
        ok: false,
        reason:
          'The League client does not have this replay, and Foxfire could not put its own copy back into League’s folder.',
        attemptedCommand: null
      }
    }
  }

  if (await watchReplay(creds, request.gameId)) return { ok: true, via: 'client' }

  return {
    ok: false,
    reason:
      'The League client would not open this replay. It may still be downloading, or the game may already be running.',
    attemptedCommand: null
  }
}

/**
 * The uncertain path, kept deliberately narrow.
 *
 * The executable is started detached with the replay as its argument and the
 * install root as its working directory — the game resolves its own data files
 * relative to where it is launched from, so that is not incidental.
 *
 * spawn only reports failures that happen before the process exists. A client
 * that starts and then refuses the replay looks identical to success from here,
 * and is left to say so in its own words rather than being second-guessed.
 */
function launchFromArchive(request: LaunchRequest): Promise<LaunchOutcome> {
  const { filePath, runner } = request
  const exe = gameExecutable(runner.path)
  const attemptedCommand = `"${exe}" "${filePath}"`

  const giveUp = (): LaunchOutcome => {
    void shell.showItemInFolder(filePath)
    return {
      ok: false,
      reason: `Foxfire could not start the archived client for patch ${runner.patch}. The replay has been shown in Explorer so you can open it yourself.`,
      attemptedCommand
    }
  }

  return new Promise<LaunchOutcome>((resolve) => {
    let settled = false
    const finish = (outcome: LaunchOutcome): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    try {
      const child = spawn(exe, [filePath], {
        cwd: dirname(exe),
        detached: true,
        stdio: 'ignore'
      })

      child.on('error', (err) => {
        log.warn('Could not start an archived client', {
          patch: runner.patch,
          exe,
          error: String(err)
        })
        finish(giveUp())
      })

      child.unref()

      // Nothing further will be heard from a detached process, so a short grace
      // period is all that separates "failed to start" from "started". An error
      // event fires well inside this.
      setTimeout(() => {
        log.info('Started an archived client for a replay', { patch: runner.patch, filePath })
        finish({ ok: true, via: 'archive' })
      }, 300).unref()
    } catch (err) {
      log.warn('Spawning an archived client threw', { exe, error: String(err) })
      finish(giveUp())
    }
  })
}
