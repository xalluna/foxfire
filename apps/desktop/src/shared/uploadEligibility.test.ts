import { describe, expect, it } from 'vitest'
import { canUploadRecording, isUploadPending, PENDING_UPLOAD_STATES } from './uploadEligibility'
import type { RecordingUpload, UploadState } from './types'

const upload = (state: UploadState): RecordingUpload => ({
  state,
  trigger: 'manual',
  bytesSent: 0,
  fileBytes: null,
  error: null,
  resumesAt: null
})

const onDisk = { fileExists: true, youtube: null, upload: null }

describe('isUploadPending', () => {
  it('is every state that carries on by itself, and nothing else', () => {
    for (const state of PENDING_UPLOAD_STATES) expect(isUploadPending(upload(state))).toBe(true)

    expect(isUploadPending(upload('done'))).toBe(false)
    expect(isUploadPending(upload('failed'))).toBe(false)
    expect(isUploadPending(null)).toBe(false)
  })
})

describe('canUploadRecording', () => {
  // The desktop's vitest config builds with YouTube in, so this is the rule a
  // YouTube build applies. A build without it offers nothing at all.
  it('offers a recording with a file, no video and nothing on its way', () => {
    expect(canUploadRecording(onDisk)).toBe(true)
    expect(canUploadRecording({ ...onDisk, upload: upload('failed') })).toBe(true)
  })

  it('offers nothing whose file is gone, that is already up, or that is on its way', () => {
    expect(canUploadRecording({ ...onDisk, fileExists: false })).toBe(false)
    expect(
      canUploadRecording({
        ...onDisk,
        youtube: { videoId: 'dQw4w9WgXcQ', privacy: 'unlisted', forcedPrivate: false, source: 'upload', title: null, at: 0 }
      })
    ).toBe(false)
    expect(canUploadRecording({ ...onDisk, upload: upload('uploading') })).toBe(false)
  })
})
