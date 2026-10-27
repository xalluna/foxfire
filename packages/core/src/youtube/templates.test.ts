import { describe, expect, it } from 'vitest'
import type { RecordingEvent } from '../types'
import {
  buildRecordingDescription,
  buildTftRecordingDescription,
  DEFAULT_TFT_TITLE_TEMPLATE,
  DEFAULT_TITLE_TEMPLATE,
  DESCRIPTION_FOOTER,
  DESCRIPTION_MAX_BYTES,
  descriptionBytes,
  formatTimestamp,
  queueLabel,
  renderRecordingTitle,
  renderTftRecordingTitle,
  TITLE_MAX_CHARS,
  UNMATCHED_TFT_TITLE_TEMPLATE,
  UNMATCHED_TITLE_TEMPLATE,
  type RecordingTitleFacts,
  type TftRecordingTitleFacts
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

describe('TFT titles', () => {
  const FIRST: TftRecordingTitleFacts = {
    queueId: 1100,
    placement: 1,
    teamPlacement: null,
    trait: 'Flora Fatalis',
    playedAt: new Date(2026, 9, 23, 21, 15).getTime()
  }

  it('reads place, queue and trait by default', () => {
    expect(renderTftRecordingTitle(DEFAULT_TFT_TITLE_TEMPLATE, FIRST)).toBe('1st · Ranked TFT · Flora Fatalis')
  })

  it("names the team's place in Double Up", () => {
    expect(
      renderTftRecordingTitle(DEFAULT_TFT_TITLE_TEMPLATE, { ...FIRST, queueId: 1160, placement: 3, teamPlacement: 2 })
    ).toBe('2nd · Double Up · Flora Fatalis')
  })

  it('drops what an unmatched recording cannot say', () => {
    const unmatched = { ...FIRST, placement: null, trait: null }
    expect(renderTftRecordingTitle(DEFAULT_TFT_TITLE_TEMPLATE, unmatched)).toBe('Ranked TFT')
    expect(renderTftRecordingTitle(UNMATCHED_TFT_TITLE_TEMPLATE, unmatched)).toBe('Ranked TFT · 23 Oct 2026')
    expect(renderTftRecordingTitle('{trait}', unmatched)).toBe('Teamfight Tactics recording')
  })

  it('names an event queue by its mode rather than not at all', () => {
    expect(queueLabel(6000, 'TFT')).toBe('Teamfight Tactics')
  })

  it('writes the credit alone as a description', () => {
    expect(buildTftRecordingDescription()).toBe(DESCRIPTION_FOOTER)
  })
})
