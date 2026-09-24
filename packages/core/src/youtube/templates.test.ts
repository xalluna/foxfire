import { describe, expect, it } from 'vitest'
import type { RecordingEvent } from '../types'
import {
  buildRecordingDescription,
  DEFAULT_TITLE_TEMPLATE,
  DESCRIPTION_FOOTER,
  DESCRIPTION_MAX_BYTES,
  descriptionBytes,
  formatTimestamp,
  queueLabel,
  renderRecordingTitle,
  TITLE_MAX_CHARS,
  UNMATCHED_TITLE_TEMPLATE,
  type RecordingTitleFacts
} from './templates'

const AHRI: RecordingTitleFacts = {
  champion: 'Ahri',
  queueId: 420,
  gameMode: 'CLASSIC',
  win: true,
  kills: 12,
  deaths: 3,
  assists: 8,
  playedAt: new Date(2026, 8, 23, 20, 15).getTime()
}

function event(videoTime: number, role: RecordingEvent['role'], label: string | null = 'Riven'): RecordingEvent {
  return { eventId: videoTime, name: 'ChampionKill', gameTime: videoTime + 90, videoTime, role, label }
}

describe('renderRecordingTitle', () => {
  it('fills the default template the way the upload form shows it', () => {
    expect(renderRecordingTitle(DEFAULT_TITLE_TEMPLATE, AHRI)).toBe('Ahri · Ranked Solo/Duo · Victory · 12/3/8')
  })

  it('drops a token with nothing to say, and the separator beside it', () => {
    const unmatched = { ...AHRI, queueId: null, gameMode: 'PRACTICETOOL', win: null, kills: null, deaths: null, assists: null }
    expect(renderRecordingTitle(DEFAULT_TITLE_TEMPLATE, unmatched)).toBe('Ahri · Practice Tool')
    expect(renderRecordingTitle(UNMATCHED_TITLE_TEMPLATE, unmatched)).toBe('Ahri · Practice Tool · 23 Sep 2026')
  })

  it('leaves a token it does not know as typed, so a preview shows the typo', () => {
    expect(renderRecordingTitle('{champoin} {result}', AHRI)).toBe('{champoin} Victory')
  })

  it('reads tokens without caring about case', () => {
    expect(renderRecordingTitle('{Champion} – {KDA}', AHRI)).toBe('Ahri – 12/3/8')
  })

  it('strips the angle brackets YouTube refuses', () => {
    expect(renderRecordingTitle('<b>{champion}</b>', AHRI)).toBe('bAhri/b')
  })

  it('never goes over 100 characters', () => {
    const long = renderRecordingTitle('{champion} '.repeat(40), AHRI)
    expect(Array.from(long).length).toBeLessThanOrEqual(TITLE_MAX_CHARS)
  })

  it('never comes back empty', () => {
    const nothing = { ...AHRI, champion: null, queueId: null, gameMode: null, win: null, kills: null, deaths: null, assists: null, playedAt: null }
    expect(renderRecordingTitle(DEFAULT_TITLE_TEMPLATE, nothing)).toBe('League of Legends recording')
  })
})

describe('queueLabel', () => {
  it('spells the queue out, and falls back to the game mode', () => {
    expect(queueLabel(420, 'CLASSIC')).toBe('Ranked Solo/Duo')
    expect(queueLabel(null, 'PRACTICETOOL')).toBe('Practice Tool')
    expect(queueLabel(9999, 'NEXUSBLITZ')).toBe('Nexusblitz')
    expect(queueLabel(null, null)).toBeNull()
  })
})

describe('formatTimestamp', () => {
  it('writes what YouTube reads as a timestamp', () => {
    expect(formatTimestamp(0)).toBe('0:00')
    expect(formatTimestamp(252.9)).toBe('4:12')
    expect(formatTimestamp(3727)).toBe('1:02:07')
  })
})

describe('buildRecordingDescription', () => {
  it('starts at 0:00 and ends with the credit', () => {
    const text = buildRecordingDescription([])
    expect(text).toBe(`0:00 Start\n\n${DESCRIPTION_FOOTER}`)
  })

  it('lists kills, deaths and multikills a few seconds early, and leaves assists to the markers', () => {
    const text = buildRecordingDescription([
      event(255, 'kill'),
      event(600, 'assist'),
      event(903, 'death', 'Zed'),
      event(1500, 'multikill', '3')
    ])
    expect(text.split('\n')).toEqual([
      '0:00 Start',
      '4:12 Killed Riven',
      '15:00 Killed by Zed',
      '24:57 Triple kill',
      '',
      DESCRIPTION_FOOTER
    ])
  })

  it('puts events less than ten seconds apart on one line, because YouTube drops shorter chapters', () => {
    const text = buildRecordingDescription([event(400, 'kill', 'Riven'), event(404, 'kill', 'Ahri'), event(404, 'multikill', '2')])
    expect(text.split('\n')[1]).toBe('6:37 Killed Riven, killed Ahri, double kill')
  })

  it('sorts what it is given', () => {
    const text = buildRecordingDescription([event(900, 'kill', 'B'), event(300, 'kill', 'A')])
    expect(text.split('\n').slice(1, 3)).toEqual(['4:57 Killed A', '14:57 Killed B'])
  })

  it('stays under 5,000 bytes and keeps the credit when a game has too much in it', () => {
    const events = Array.from({ length: 800 }, (_, i) => event(20 + i * 11, 'kill', 'Somebody with a very long name'))
    const text = buildRecordingDescription(events)
    expect(descriptionBytes(text)).toBeLessThanOrEqual(DESCRIPTION_MAX_BYTES)
    expect(text.endsWith(DESCRIPTION_FOOTER)).toBe(true)
  })
})
