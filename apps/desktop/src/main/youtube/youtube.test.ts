import { describe, expect, it } from 'vitest'
import type { Account } from '@foxfire/core'
import { planAttachments, serverAccountFor } from './attachPlan'
import {
  buildAuthUrl,
  challengeFor,
  createPkce,
  emailFromIdToken,
  grantsUpload,
  parseCallback,
  UPLOAD_SCOPE
} from './oauthFlow'
import { nextPacificMidnight } from './quota'
import {
  backoffMs,
  CHUNK_BYTES,
  classifyYouTubeError,
  forcedPrivate,
  insertMetadata,
  nextChunk,
  offsetFromRange
} from './resumable'

describe('signing in to Google', () => {
  it('makes a PKCE pair whose challenge is the SHA-256 of the verifier', () => {
    const { verifier, challenge } = createPkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(challengeFor(verifier))
    // RFC 7636's own example.
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('asks for upload and the email address, a refresh token, and S256', () => {
    const url = new URL(
      buildAuthUrl({ clientId: 'client', redirectUri: 'http://127.0.0.1:5000/', state: 's', challenge: 'c' })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe(`openid email ${UPLOAD_SCOPE}`)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5000/')
  })

  it('takes the code only from a redirect carrying its own state', () => {
    const at = (query: string): URL => new URL(`http://127.0.0.1:5000/?${query}`)
    expect(parseCallback(at('state=abc&code=xyz'), 'abc')).toEqual({ ok: true, code: 'xyz' })
    expect(parseCallback(at('state=other&code=xyz'), 'abc').ok).toBe(false)
    expect(parseCallback(at('state=abc&error=access_denied'), 'abc')).toEqual({
      ok: false,
      message: 'Google was not given permission, so nothing was connected.'
    })
    expect(parseCallback(at('state=abc'), 'abc').ok).toBe(false)
  })

  it('notices when somebody unticked the upload permission', () => {
    expect(grantsUpload(`openid ${UPLOAD_SCOPE} email`)).toBe(true)
    expect(grantsUpload('openid email')).toBe(false)
    expect(grantsUpload(undefined)).toBe(false)
  })

  it('reads the address out of the ID token', () => {
    const payload = Buffer.from(JSON.stringify({ email: 'faker@example.com' })).toString('base64url')
    expect(emailFromIdToken(`header.${payload}.signature`)).toBe('faker@example.com')
    expect(emailFromIdToken('not a token')).toBeNull()
    expect(emailFromIdToken(undefined)).toBeNull()
  })
})

describe('the resumable upload', () => {
  it('describes the video as a gaming upload, not made for kids', () => {
    expect(insertMetadata({ title: 'T', description: 'D', privacy: 'unlisted' })).toEqual({
      snippet: { title: 'T', description: 'D', categoryId: '20' },
      status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false }
    })
  })

  it('sends chunks in multiples of 256 KiB, and a short last one', () => {
    expect(CHUNK_BYTES % (256 * 1024)).toBe(0)
    expect(nextChunk(0, 20_000_000)).toEqual({ start: 0, end: CHUNK_BYTES - 1 })
    expect(nextChunk(2 * CHUNK_BYTES, 20_000_000)).toEqual({ start: 2 * CHUNK_BYTES, end: 19_999_999 })
  })

  it('carries on from the byte after the last one YouTube has', () => {
    expect(offsetFromRange('bytes=0-524287')).toBe(524_288)
    expect(offsetFromRange(null)).toBe(0)
  })

  it('tells a spent quota from a channel that does not exist, though both are 403', () => {
    const body = (reason: string) => ({ error: { errors: [{ reason }] } })
    expect(classifyYouTubeError(403, body('quotaExceeded')).kind).toBe('quota')
    expect(classifyYouTubeError(400, body('uploadLimitExceeded')).kind).toBe('quota')
    expect(classifyYouTubeError(401, body('youtubeSignupRequired')).kind).toBe('fatal')
    expect(classifyYouTubeError(403, body('rateLimitExceeded')).kind).toBe('backoff')
    expect(classifyYouTubeError(401, {}).kind).toBe('auth')
    expect(classifyYouTubeError(404, {}).kind).toBe('restart')
    expect(classifyYouTubeError(503, null).kind).toBe('backoff')
    expect(classifyYouTubeError(400, { error: { message: 'Bad request' } })).toEqual({
      kind: 'fatal',
      message: 'Bad request'
    })
  })

  it('backs off from thirty seconds to an hour, with jitter', () => {
    const middle = (): number => 0.5
    expect(backoffMs(1, middle)).toBe(30_000)
    expect(backoffMs(3, middle)).toBe(120_000)
    expect(backoffMs(20, middle)).toBe(3_600_000)
    expect(backoffMs(1, () => 0)).toBe(24_000)
  })

  it('knows when YouTube made a video private that was not asked to be', () => {
    expect(forcedPrivate('unlisted', 'private')).toBe(true)
    expect(forcedPrivate('private', 'private')).toBe(false)
    expect(forcedPrivate('public', 'public')).toBe(false)
  })
})

describe('nextPacificMidnight', () => {
  it('is 07:00 UTC in summer', () => {
    expect(nextPacificMidnight(Date.UTC(2026, 8, 23, 20, 0))).toBe(Date.UTC(2026, 8, 24, 7, 0))
  })

  it('is 08:00 UTC in winter', () => {
    expect(nextPacificMidnight(Date.UTC(2026, 11, 2, 12, 0))).toBe(Date.UTC(2026, 11, 3, 8, 0))
  })

  it('gets the nights the clocks change right', () => {
    // 1 November 2026: clocks go back at 02:00, so that midnight is still PDT…
    expect(nextPacificMidnight(Date.UTC(2026, 9, 31, 20, 0))).toBe(Date.UTC(2026, 10, 1, 7, 0))
    // …and the next one is PST.
    expect(nextPacificMidnight(Date.UTC(2026, 10, 1, 20, 0))).toBe(Date.UTC(2026, 10, 2, 8, 0))
    // 8 March 2026: clocks go forward at 02:00, so that midnight is still PST.
    expect(nextPacificMidnight(Date.UTC(2026, 2, 7, 20, 0))).toBe(Date.UTC(2026, 2, 8, 8, 0))
  })

  it('is later than now, even a second before midnight', () => {
    const now = Date.UTC(2026, 8, 24, 6, 59, 59)
    expect(nextPacificMidnight(now)).toBe(Date.UTC(2026, 8, 24, 7, 0))
  })
})

describe('planAttachments', () => {
  const account = (over: Partial<Account>): Account => ({
    id: 'guid-ahri',
    puuid: 'p',
    gameName: 'Ahri Main',
    tagLine: 'NA1',
    platform: 'na1',
    regionalRoute: 'americas',
    summonerId: null,
    profileIconId: null,
    summonerLevel: null,
    isHomeAccount: false,
    createdAt: '',
    updatedAt: '',
    isMine: true,
    ...over
  })

  const candidate = {
    recordingId: 1,
    accountId: 'guid-ahri',
    riotId: 'Ahri Main#NA1',
    matchId: 'NA1_1',
    videoId: 'dQw4w9WgXcQ',
    attachedVideoId: null
  }

  it('attaches a new video to the owner’s own account', () => {
    expect(planAttachments([candidate], [account({})])).toEqual([
      { recordingId: 1, riotAccountId: 'guid-ahri', matchId: 'NA1_1', videoId: 'dQw4w9WgXcQ', replace: false }
    ])
  })

  it('finds a recording made in local-only mode by its Riot ID', () => {
    const local = { ...candidate, accountId: '3', riotId: 'ahri main#na1' }
    expect(planAttachments([local], [account({})])[0]?.riotAccountId).toBe('guid-ahri')
    expect(serverAccountFor({ accountId: '3', riotId: null }, [account({})])).toBeNull()
  })

  it('never attaches to an account somebody else claimed, or nobody did', () => {
    expect(planAttachments([candidate], [account({ isMine: false })])).toEqual([])
    expect(planAttachments([candidate], [account({ isMine: undefined })])).toEqual([])
  })

  it('leaves a video the server was already told about alone, so a removal stays removed', () => {
    expect(planAttachments([{ ...candidate, attachedVideoId: 'dQw4w9WgXcQ' }], [account({})])).toEqual([])
  })

  it('replaces the server’s copy when the recording has a new video', () => {
    expect(planAttachments([{ ...candidate, attachedVideoId: 'oldVideo123' }], [account({})])[0]?.replace).toBe(true)
  })
})
