import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { ServerError, type ReplayDownloadGrant } from '@foxfire/core/server'
import { authedRequest, isServerMode, serverApi } from '../services/serverService'
import { createLogger } from '../telemetry/logger'

const log = createLogger('replay-sharing')

/**
 * Putting a .rofl where the rest of the community can watch it, and fetching
 * one somebody else put there.
 *
 * The bytes never go through the Foxfire server. It hands out a URL signed for
 * a quarter of an hour and the file goes straight into the blob store — which
 * matters most for the host, whose homelab would otherwise carry every replay
 * on the server twice, but also for whoever is uploading: one hop rather than
 * two over the same domestic connection.
 *
 * Every function here is a no-op in local-only mode and after any failure. A
 * replay is a nice thing to have and never a thing anything else waits on: the
 * file is already on this disk, already listed, and already playable by whoever
 * ingested it. Sharing it is the extra.
 */

/** What the server says when it agrees to take one. */
interface UploadGrant {
  matchId: string
  uploadUrl: string
  expiresAt: string
}

/** What the server says about one it already has. */
export interface SharedReplayInfo {
  matchId: string
  patch: string | null
  gameVersion: string | null
  fileBytes: number | null
  durationSeconds: number | null
  uploadedBy: string | null
  uploadedAt: string | null
}

/**
 * Offers a replay to the active server.
 *
 * Returns whether this upload is the one that landed it. False covers every
 * ordinary reason not to: local-only mode, a server with no blob store, a
 * replay whose match is unknown, and — the common one — somebody else in the
 * same game having already uploaded it. Nine of the ten players will get that
 * answer, and it is not a failure.
 */
export async function shareReplay(
  matchId: string | null,
  filePath: string,
  meta: { gameVersion: string | null; patch: string | null; durationSeconds: number | null }
): Promise<boolean> {
  if (!isServerMode() || matchId === null) return false

  let fileBytes: number
  try {
    fileBytes = statSync(filePath).size
  } catch {
    return false
  }

  let grant: UploadGrant
  try {
    grant = await authedRequest<UploadGrant>('/replays/claim', {
      method: 'POST',
      body: { matchId, ...meta, fileBytes }
    })
  } catch (err) {
    // 409 is the expected answer for most of a premade, and 503 is a server
    // that does not do replays at all. Neither is worth a line in the log every
    // time somebody finishes a game.
    if (err instanceof ServerError && (err.status === 409 || err.status === 503)) return false

    log.debug('Could not claim a replay upload', { matchId, error: String(err) })
    return false
  }

  try {
    await putFile(grant.uploadUrl, filePath, fileBytes)
  } catch (err) {
    // The claim is left where it is. It goes stale on the server after half an
    // hour, and until then a retry from this machine is allowed to take it back
    // — so an upload interrupted halfway is not a game lost to the library.
    log.debug('Could not upload a replay', { matchId, error: String(err) })
    return false
  }

  try {
    await authedRequest<SharedReplayInfo>(`/replays/${encodeURIComponent(matchId)}/complete`, {
      method: 'POST'
    })
  } catch (err) {
    log.debug('Uploaded a replay but could not confirm it', { matchId, error: String(err) })
    return false
  }

  log.info('Shared a replay with the server', { matchId, fileBytes })
  return true
}

/**
 * Fetches a replay somebody else uploaded, and hands back the bytes.
 *
 * Returns null whenever it cannot, which includes a server that has no such
 * replay — the caller's job is to put the file somewhere, and this one's is to
 * get it.
 */
export async function fetchSharedReplay(matchId: string): Promise<Buffer | null> {
  if (!isServerMode()) return null

  let grant: ReplayDownloadGrant
  try {
    grant = await serverApi().replays.downloadGrant(matchId)
  } catch (err) {
    log.debug('No shared replay to download', { matchId, error: String(err) })
    return null
  }

  try {
    // Straight from the store. The signed URL is the whole of the
    // authorisation, so this request carries no Foxfire token — and must not,
    // since it is going somewhere that is not the Foxfire server.
    const response = await fetch(grant.downloadUrl)
    if (!response.ok) {
      log.debug('The blob store refused a download', { matchId, status: response.status })
      return null
    }

    return Buffer.from(await response.arrayBuffer())
  } catch (err) {
    log.debug('Could not download a shared replay', { matchId, error: String(err) })
    return null
  }
}

/**
 * Streams a file into a signed URL.
 *
 * Streamed rather than read into memory: a .rofl is tens of megabytes, and the
 * main process is also running the app's windows. `x-ms-blob-type` is what
 * makes it a block blob, and the store refuses the PUT without it.
 *
 * duplex: 'half' is required by undici for a streaming body, and its absence is
 * a runtime error rather than a type one.
 */
async function putFile(url: string, filePath: string, fileBytes: number): Promise<void> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'x-ms-blob-type': 'BlockBlob',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(fileBytes)
    },
    body: Readable.toWeb(createReadStream(filePath)) as ReadableStream,
    duplex: 'half'
  } as RequestInit & { duplex: 'half' })

  if (!response.ok) {
    throw new Error(`The blob store refused the upload (${response.status})`)
  }
}
