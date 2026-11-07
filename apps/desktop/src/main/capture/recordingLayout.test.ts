import { describe, expect, it } from 'vitest'
import {
  accountFolder,
  foldersBetween,
  isUnder,
  modeFolder,
  plannedRecordingPath,
  recordingFileName,
  sanitizeWindowsSegment,
  withCollisionSuffix
} from './recordingLayout'

const ROOT = 'C:\\Videos\\Foxfire'

/** 21:04:17 on 23 October 2026, in this PC's own time zone, as a recording's start is read. */
const STARTED = new Date(2026, 9, 23, 21, 4, 17).getTime()

describe('plannedRecordingPath', () => {
  it('files a League game under the player, the game and the mode', () => {
    expect(
      plannedRecordingPath({
        root: ROOT,
        riotId: 'Faker#KR1',
        game: 'lol',
        queueId: 420,
        startedAt: STARTED,
        sourcePath: `${ROOT}\\2026-10-23 21-04-15.mp4`
      })
    ).toBe('C:\\Videos\\Foxfire\\Faker-KR1\\LoL\\Solo-Duo\\2026-10-23 21-04-17.mp4')
  })

  it('files a TFT game the same way, under TFT', () => {
    expect(
      plannedRecordingPath({
        root: ROOT,
        riotId: 'Faker#KR1',
        game: 'tft',
        queueId: 1100,
        startedAt: STARTED,
        sourcePath: `${ROOT}\\x.mkv`
      })
    ).toBe('C:\\Videos\\Foxfire\\Faker-KR1\\TFT\\Ranked\\2026-10-23 21-04-17.mkv')
  })

  it('puts a recording nobody claimed under Unknown, and a queue nobody listed under Other', () => {
    expect(
      plannedRecordingPath({ root: ROOT, riotId: null, game: 'lol', queueId: 2400, startedAt: STARTED, sourcePath: 'a.mp4' })
    ).toBe('C:\\Videos\\Foxfire\\Unknown\\LoL\\Other\\2026-10-23 21-04-17.mp4')
  })

  it('does not file a League queue under TFT, or the other way round', () => {
    expect(modeFolder('tft', 420)).toBe('Other')
    expect(modeFolder('lol', 1160)).toBe('Other')
    expect(modeFolder('tft', 1160)).toBe('Double-Up')
  })
})

describe('names Windows will take', () => {
  it('replaces what Windows refuses in a name', () => {
    expect(sanitizeWindowsSegment('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
    expect(sanitizeWindowsSegment('tab\there')).toBe('tab_here')
  })

  it('drops trailing dots and spaces, which Windows would drop silently', () => {
    expect(sanitizeWindowsSegment('Faker. ')).toBe('Faker')
    expect(accountFolder('Dots...#NA1')).toBe('Dots...-NA1')
  })

  it('keeps clear of device names, with or without an extension', () => {
    expect(sanitizeWindowsSegment('CON')).toBe('CON_')
    expect(sanitizeWindowsSegment('com1')).toBe('com1_')
    expect(sanitizeWindowsSegment('nul.txt')).toBe('nul.txt_')
    expect(sanitizeWindowsSegment('Console')).toBe('Console')
  })

  it('caps a long name and falls back when nothing is left', () => {
    expect(sanitizeWindowsSegment('x'.repeat(100))).toHaveLength(64)
    expect(sanitizeWindowsSegment('...', 'Unknown')).toBe('Unknown')
  })

  it('keeps a Riot ID’s own letters, composed', () => {
    expect(accountFolder('Cafe\u0301#EUW')).toBe('Café-EUW')
    expect(accountFolder('페이커#KR1')).toBe('페이커-KR1')
  })
})

describe('the rest of the rule', () => {
  it('names a file by its local start time', () => {
    expect(recordingFileName(STARTED, '.mp4')).toBe('2026-10-23 21-04-17.mp4')
  })

  it('numbers a second recording that started in the same second', () => {
    const taken = new Set(['C:\\v\\a.mp4', 'C:\\v\\a (2).mp4'])
    expect(withCollisionSuffix('C:\\v\\a.mp4', (p) => taken.has(p))).toBe('C:\\v\\a (3).mp4')
    expect(withCollisionSuffix('C:\\v\\b.mp4', (p) => taken.has(p))).toBe('C:\\v\\b.mp4')
  })

  it('moves only what is inside the folder', () => {
    expect(isUnder(ROOT, `${ROOT}\\a.mp4`)).toBe(true)
    expect(isUnder(ROOT, 'D:\\Elsewhere\\a.mp4')).toBe(false)
    expect(isUnder(ROOT, `${ROOT}Else\\a.mp4`)).toBe(false)
    expect(isUnder(ROOT, ROOT)).toBe(false)
  })

  it('lists the folders a deleted file may have emptied, never the root', () => {
    expect(foldersBetween(ROOT, `${ROOT}\\Faker-KR1\\TFT\\Ranked\\a.mp4`)).toEqual([
      `${ROOT}\\Faker-KR1\\TFT\\Ranked`,
      `${ROOT}\\Faker-KR1\\TFT`,
      `${ROOT}\\Faker-KR1`
    ])
    expect(foldersBetween(ROOT, `${ROOT}\\a.mp4`)).toEqual([])
    expect(foldersBetween(ROOT, 'D:\\a.mp4')).toEqual([])
  })
})
