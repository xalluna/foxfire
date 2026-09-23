import { describe, expect, it } from 'vitest'
import { isYouTubeVideoId, parseYouTubeVideoId, youtubeErrorMessage, youtubeWatchUrl } from './videoId'

const ID = 'dQw4w9WgXcQ'

describe('parseYouTubeVideoId', () => {
  it('takes a bare id as it is', () => {
    expect(parseYouTubeVideoId(ID)).toBe(ID)
    expect(parseYouTubeVideoId(`  ${ID}\n`)).toBe(ID)
  })

  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}&t=42s`,
    `https://www.youtube.com/watch?list=PL123&v=${ID}&index=2`,
    `http://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}&si=abc`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=share-token&t=10`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/embed/${ID}?start=5`,
    `https://www.youtube.com/live/${ID}?feature=share`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `youtube.com/watch?v=${ID}`,
    `youtu.be/${ID}`
  ])('reads %s', (input) => {
    expect(parseYouTubeVideoId(input)).toBe(ID)
  })

  it.each([
    '',
    'not a link',
    'dQw4w9WgXc',
    `https://vimeo.com/${ID}`,
    `https://example.com/watch?v=${ID}`,
    `https://youtube.com.evil.example/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=short`,
    `https://www.youtube.com/channel/UC1234567890`,
    `https://www.youtube.com/@somebody`,
    `javascript:alert('${ID}')`,
    `ftp://youtube.com/watch?v=${ID}`
  ])('refuses %j', (input) => {
    expect(parseYouTubeVideoId(input)).toBeNull()
  })
})

describe('the rest', () => {
  it('knows an id when it sees one', () => {
    expect(isYouTubeVideoId(ID)).toBe(true)
    expect(isYouTubeVideoId(`${ID}x`)).toBe(false)
    expect(isYouTubeVideoId('abc/defghij')).toBe(false)
  })

  it('builds the watch URL', () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`)
  })

  it('says what the player errors mean, and names the one that is about the embedder', () => {
    expect(youtubeErrorMessage(100)).toMatch(/private/)
    expect(youtubeErrorMessage(150)).toMatch(/outside YouTube/)
    expect(youtubeErrorMessage(153)).toMatch(/where it was being played from/)
    expect(youtubeErrorMessage(9999)).toMatch(/9999/)
  })
})
