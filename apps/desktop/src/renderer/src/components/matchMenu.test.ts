import { describe, expect, it } from 'vitest'
import { downloadBlockedReason, matchContextItems } from './matchMenu'
import type { MatchSummary } from '@shared/types'

/**
 * What the row's menu offers, and what it says when it cannot.
 *
 * Only the replay-download half is covered here, because it is the part with a
 * middle state: a game can have no server copy, a server copy worth fetching,
 * or a server copy of something already on this disk — and the third is a
 * pointless download rather than an unavailable one, which is a different
 * sentence to put in front of somebody.
 */
const MATCH: MatchSummary = {
  matchId: 'NA1_5312345678',
  gameCreation: 1_760_000_000_000,
  gameDuration: 1800,
  gameMode: 'CLASSIC',
  queueId: 420,
  win: true,
  championId: 64,
  championName: 'Lee Sin',
  champLevel: 16,
  kills: 8,
  deaths: 4,
  assists: 6,
  cs: 190,
  goldEarned: 13_000,
  damageDealtToChampions: 20_000,
  largestMultiKill: 2,
  items: [],
  roleBoundItem: 0,
  summoner1Id: 4,
  summoner2Id: 14,
  perks: null,
  teamPosition: 'JUNGLE',
  teamKills: 20,
  teamDamage: 80_000,
  isRemake: false,
  rank: null,
  hasManualRank: false,
  recordingId: null,
  replayId: null
}

const NOTHING = {
  onEditLp: () => {},
  onClearLp: () => {},
  onCopyId: () => {},
  onOpenDetails: () => {},
  onWatchRecording: () => {},
  onWatchReplay: () => {},
  onDownloadReplay: () => {}
}

describe('downloadBlockedReason', () => {
  it('has nothing to offer when nobody has uploaded the game', () => {
    expect(downloadBlockedReason(MATCH)).toBe('Nobody has uploaded this game')
  })

  it('offers the download when the server has one and this machine does not', () => {
    expect(
      downloadBlockedReason({ ...MATCH, sharedReplay: { patch: '15.16', fileBytes: 31_000_000 } })
    ).toBeNull()
  })

  it('says the file is already here rather than that it is unavailable', () => {
    // The two are not the same thing to somebody reading the menu, and the
    // download would be a wasted 30 MB of a host's upstream.
    expect(
      downloadBlockedReason({
        ...MATCH,
        replayId: 7,
        sharedReplay: { patch: '15.16', fileBytes: 31_000_000 }
      })
    ).toBe('Already downloaded')
  })
})

describe('matchContextItems', () => {
  it('leaves the download out entirely when there is no server copy', () => {
    // Hidden rather than disabled, unlike the two items above it: those are
    // about a game you played and the absence is worth explaining, while a
    // permanently greyed row on every match in local-only mode explains nothing.
    const labels = matchContextItems(MATCH, NOTHING).map((item) => item.label)

    expect(labels).not.toContain(expect.stringContaining('Download replay'))
    expect(labels.some((label) => label.startsWith('Download replay'))).toBe(false)
  })

  it('names the patch on the item, because that is what decides playability', () => {
    const items = matchContextItems(
      { ...MATCH, sharedReplay: { patch: '15.14', fileBytes: 31_000_000 } },
      NOTHING
    )

    const download = items.find((item) => item.label.startsWith('Download replay'))

    expect(download?.label).toBe('Download replay (patch 15.14)')
    expect(download?.disabledReason).toBeUndefined()
  })

  it('still offers a download when the header gave no patch', () => {
    // Riot has changed that format before, and a replay whose patch could not
    // be read is still a replay — the client either plays it or does not.
    const items = matchContextItems(
      { ...MATCH, sharedReplay: { patch: null, fileBytes: null } },
      NOTHING
    )

    expect(items.some((item) => item.label === 'Download replay')).toBe(true)
  })
})
