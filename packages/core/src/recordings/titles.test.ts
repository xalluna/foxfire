import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TFT_TITLE_TEMPLATE,
  DEFAULT_TITLE_TEMPLATE,
  queueLabel,
  renderRecordingTitle,
  renderTftRecordingTitle,
  TITLE_MAX_CHARS,
  UNMATCHED_TFT_TITLE_TEMPLATE,
  UNMATCHED_TITLE_TEMPLATE,
  type RecordingTitleFacts,
  type TftRecordingTitleFacts
} from './titles'

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

  it('strips angle brackets', () => {
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
})
