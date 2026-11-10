import { describe, expect, it } from 'vitest'
import { canUploadRecording, isUploadPending, PENDING_UPLOAD_STATES } from './uploadEligibility'
import type { RecordingUpload, UploadState } from './types'

const SERVER = 'https://foxfire.example.com'

const upload = (state: UploadState): RecordingUpload => ({
  state,
  trigger: 'manual',
  bytesSent: 0,
  fileBytes: null,
  deleteAfter: false,
  error: null,
  resumesAt: null
})

const onDisk = { fileExists: true, matchId: 'NA1_1', server: null, upload: null }

describe('isUploadPending', () => {
  it('is every state that carries on by itself, and nothing else', () => {
    for (const state of PENDING_UPLOAD_STATES) expect(isUploadPending(upload(state))).toBe(true)

    expect(isUploadPending(upload('done'))).toBe(false)
    expect(isUploadPending(upload('failed'))).toBe(false)
    expect(isUploadPending(upload('cancelled'))).toBe(false)
    expect(isUploadPending(null)).toBe(false)
  })

  it('counts a recording the server is still processing as on its way', () => {
    expect(isUploadPending(upload('processing'))).toBe(true)
  })
})

describe('canUploadRecording', () => {
  it('offers a recording with a file and a game, not on this server, and nothing on its way', () => {
    expect(canUploadRecording(onDisk, SERVER)).toBe(true)
    expect(canUploadRecording({ ...onDisk, upload: upload('failed') }, SERVER)).toBe(true)
    expect(canUploadRecording({ ...onDisk, upload: upload('cancelled') }, SERVER)).toBe(true)
  })

  it('offers nothing whose file is gone, that is already up, or that is on its way', () => {
    expect(canUploadRecording({ ...onDisk, fileExists: false }, SERVER)).toBe(false)
    expect(canUploadRecording({ ...onDisk, server: { videoId: 'abc', serverKey: SERVER, at: 0 } }, SERVER)).toBe(false)
    expect(canUploadRecording({ ...onDisk, upload: upload('uploading') }, SERVER)).toBe(false)
  })

  it('offers nothing that never found its game, which the server has nowhere to keep', () => {
    expect(canUploadRecording({ ...onDisk, matchId: null }, SERVER)).toBe(false)
  })

  it('offers nothing in local-only mode, and offers again on a server that does not have it', () => {
    expect(canUploadRecording(onDisk, null)).toBe(false)
    expect(
      canUploadRecording({ ...onDisk, server: { videoId: 'abc', serverKey: 'https://other.example.com', at: 0 } }, SERVER)
    ).toBe(true)
  })
})
