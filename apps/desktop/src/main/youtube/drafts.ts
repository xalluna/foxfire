import {
  buildRecordingDescription,
  buildTftRecordingDescription,
  renderRecordingTitle,
  renderTftRecordingTitle,
  UNMATCHED_TFT_TITLE_TEMPLATE,
  UNMATCHED_TITLE_TEMPLATE,
  type RecordingTitleFacts
} from '@foxfire/core/youtube'
import { tftDisplayName, type TftMatchSummary } from '@foxfire/core'
import { tftTitleFacts } from '@shared/tftRecordingTitle'
import { serverBacked } from '../api'
import { getDb } from '../db'
import { getRecording, getRecordingEvents } from '../db/repositories/recordings.repo'
import { isServerMode } from '../services/serverService'
import { getAssetManifest } from '../services/ddragonService'
import { getYouTubeSettings } from './settings'
import type { Recording, UploadDraft } from '@shared/types'

/**
 * What the upload form opens with, and what an automatic upload is sent as.
 *
 * The title from the template in Settings, filled in from the game the
 * recording found; the description a line per kill and death, which YouTube
 * turns into chapters. A recording that never found its game gets a plainer
 * title, dated, rather than one that leaves out everything interesting.
 */
export async function draftFor(recordingId: number): Promise<UploadDraft> {
  const db = getDb()
  const recording = getRecording(db, recordingId)
  if (!recording) throw new Error('That recording is no longer on this machine.')

  const settings = getYouTubeSettings()

  // TFT's own template, from its place and board; and no chapters, since a
  // TFT recording keeps no events to make them from.
  if (recording.game === 'tft') {
    const facts = await tftFacts(recording)
    return {
      recordingId,
      title: renderTftRecordingTitle(
        facts.placement === null ? UNMATCHED_TFT_TITLE_TEMPLATE : settings.tftTitleTemplate,
        facts
      ),
      description: buildTftRecordingDescription(),
      privacy: settings.defaultPrivacy,
      durationSeconds: recording.durationSeconds
    }
  }

  const facts = await titleFacts(recording)
  const template = facts.win === null ? UNMATCHED_TITLE_TEMPLATE : settings.titleTemplate

  return {
    recordingId,
    title: renderRecordingTitle(template, facts),
    description: buildRecordingDescription(getRecordingEvents(db, recordingId)),
    privacy: settings.defaultPrivacy,
    durationSeconds: recording.durationSeconds
  }
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
