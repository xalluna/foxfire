import {
  renderRecordingTitle,
  renderTftRecordingTitle,
  UNMATCHED_TFT_TITLE_TEMPLATE,
  UNMATCHED_TITLE_TEMPLATE,
  type RecordingTitleFacts
} from '@foxfire/core/recordings'
import { tftDisplayName, type TftMatchSummary } from '@foxfire/core'
import { tftTitleFacts } from '@shared/tftRecordingTitle'
import { serverBacked } from '../api'
import { getDb } from '../db'
import { getRecording } from '../db/repositories/recordings.repo'
import { isServerMode } from '../services/serverService'
import { getAssetManifest } from '../services/ddragonService'
import { getMediaSettings } from './settings'
import type { Recording } from '@shared/types'

/**
 * What a recording is called on the server.
 *
 * The title from the template in Settings, filled in from the game the
 * recording found. A recording that never found its game gets a plainer one,
 * dated, rather than one that leaves out everything interesting — though such
 * a recording cannot go to a server anyway, which keeps it against its game.
 */
export async function titleFor(recordingId: number): Promise<string> {
  const recording = getRecording(getDb(), recordingId)
  if (!recording) throw new Error('That recording is no longer on this machine.')

  const settings = getMediaSettings()

  if (recording.game === 'tft') {
    const facts = await tftFacts(recording)
    return renderTftRecordingTitle(
      facts.placement === null ? UNMATCHED_TFT_TITLE_TEMPLATE : settings.tftTitleTemplate,
      facts
    )
  }

  const facts = await titleFacts(recording)
  return renderRecordingTitle(facts.win === null ? UNMATCHED_TITLE_TEMPLATE : settings.titleTemplate, facts)
}

/**
 * The game, as far as it is known here.
 *
 * Connected to a server the match lives there rather than in this database,
 * so it is asked for; a server that cannot answer leaves a plainer title
 * rather than no upload.
 */
async function titleFacts(recording: Recording): Promise<RecordingTitleFacts> {
  let match: {
    championId: number
    championName: string | null
    queueId: number | null
    gameMode: string | null
    win: boolean
    kills: number
    deaths: number
    assists: number
    gameCreation: number
  } | null = recording.match

  if (!match && recording.matchId && isServerMode()) {
    try {
      match = (await serverBacked().dashboard.matchSummary?.(recording.accountId, recording.matchId)) ?? null
    } catch {
      match = null
    }
  }

  const championId = match?.championId ?? recording.selfChampionId
  return {
    champion: match?.championName ?? (await championNameFor(championId)),
    queueId: match?.queueId ?? recording.queueId,
    gameMode: match?.gameMode ?? null,
    win: match ? match.win : null,
    kills: match?.kills ?? null,
    deaths: match?.deaths ?? null,
    assists: match?.assists ?? null,
    playedAt: match?.gameCreation ?? recording.startedAt
  }
}

/**
 * A TFT game as far as it is known here: the recording's own board, or —
 * connected to a server, where the board lives — the server's row for it.
 */
async function tftFacts(recording: Recording) {
  let board: Pick<TftMatchSummary, 'queueId' | 'placement' | 'teamPlacement' | 'traits'> | null = recording.tftMatch

  if (!board && recording.matchId && isServerMode()) {
    try {
      board = await serverBacked().tft.matchSummary(recording.accountId, recording.matchId)
    } catch {
      board = null
    }
  }

  let manifest: Awaited<ReturnType<typeof getAssetManifest>> | null = null
  try {
    manifest = await getAssetManifest()
  } catch {
    manifest = null
  }

  return tftTitleFacts(recording, board, (id) => manifest?.tft?.traits[id.toLowerCase()]?.name ?? tftDisplayName(id))
}

async function championNameFor(championId: number | null): Promise<string | null> {
  if (championId === null) return null
  try {
    const manifest = await getAssetManifest()
    return manifest.championById[championId]?.name ?? null
  } catch {
    return null
  }
}
