import { describe, expect, it } from 'vitest'
import {
  canUploadRecording,
  isSomebodyElsesUpload,
  isUploadPending,
  PENDING_UPLOAD_STATES,
  serverAccountFor
} from './uploadEligibility'
import type { RecordingUpload, UploadState } from './types'

const SERVER = 'https://foxfire.example.com'

/** The server's answer to whose accounts are yours. */
const MINE = [{ id: '1', gameName: 'Faker', tagLine: 'NA1', isMine: true }]

const upload = (state: UploadState): RecordingUpload => ({
  state,
  trigger: 'manual',
  bytesSent: 0,
  fileBytes: null,
  deleteAfter: false,
  error: null,
  resumesAt: null
})

const onDisk = { fileExists: true, matchId: 'NA1_1', server: null, upload: null, accountId: '1', riotId: 'Faker#NA1' }

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
    expect(canUploadRecording(onDisk, SERVER, MINE)).toBe(true)
    expect(canUploadRecording({ ...onDisk, upload: upload('failed') }, SERVER, MINE)).toBe(true)
    expect(canUploadRecording({ ...onDisk, upload: upload('cancelled') }, SERVER, MINE)).toBe(true)
  })

  it('offers nothing whose file is gone, that is already up, or that is on its way', () => {
    expect(canUploadRecording({ ...onDisk, fileExists: false }, SERVER, MINE)).toBe(false)
    expect(canUploadRecording({ ...onDisk, server: { videoId: 'abc', serverKey: SERVER, at: 0 } }, SERVER, MINE)).toBe(false)
    expect(canUploadRecording({ ...onDisk, upload: upload('uploading') }, SERVER, MINE)).toBe(false)
  })

  it('offers nothing that never found its game, which the server has nowhere to keep', () => {
    expect(canUploadRecording({ ...onDisk, matchId: null }, SERVER, MINE)).toBe(false)
  })

  it('offers nothing in local-only mode, and offers again on a server that does not have it', () => {
    expect(canUploadRecording(onDisk, null, MINE)).toBe(false)
    expect(
      canUploadRecording({ ...onDisk, server: { videoId: 'abc', serverKey: 'https://other.example.com', at: 0 } }, SERVER, MINE)
    ).toBe(true)
  })
})

describe('whose a recording is', () => {
  // The Recordings tab lists every recording on this PC, and the server takes
  // an upload only from whoever claimed the account it was recorded on.
  const somebody = { ...onDisk, accountId: '0198f2c1-guid-of-theirs', riotId: 'Someone#EUW' }

  it('offers a recording made on one of your accounts, found by its id or its Riot ID', () => {
    expect(canUploadRecording(onDisk, SERVER, MINE)).toBe(true)
    // Made in local-only mode: the id is this PC's rowid, which means nothing
    // to the server, and the Riot ID — in whatever case — is what finds it.
    expect(canUploadRecording({ ...onDisk, accountId: '1', riotId: 'faker#na1' }, SERVER, [{ ...MINE[0]!, id: 'guid' }])).toBe(
      true
    )
  })

  it('offers nothing recorded on somebody else’s account, and says that is why', () => {
    expect(canUploadRecording(somebody, SERVER, MINE)).toBe(false)
    expect(isSomebodyElsesUpload(somebody, SERVER, MINE)).toBe(true)
    expect(isSomebodyElsesUpload(onDisk, SERVER, MINE)).toBe(false)
  })

  it('does not blame the account for what the file already rules out', () => {
    expect(isSomebodyElsesUpload({ ...somebody, fileExists: false }, SERVER, MINE)).toBe(false)
    expect(isSomebodyElsesUpload(somebody, null, MINE)).toBe(false)
  })

  it('passes over an account the server says is somebody else’s', () => {
    expect(canUploadRecording(onDisk, SERVER, [{ ...MINE[0]!, isMine: false }])).toBe(false)
    expect(serverAccountFor(onDisk, [{ ...MINE[0]!, isMine: false }])).toBeNull()
  })
})
