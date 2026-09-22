import { describe, expect, it } from 'vitest'
import { downloadBlockedReason, matchContextItems } from './matchMenu'
import type { MatchSummary } from '@foxfire/core'

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
  hasManualRank: false
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
        local: { recordingId: null, replayId: 7 },
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

/**
 * Who may write LP against this account.
 *
 * Everything on a Foxfire server is readable by every member, so the match list
 * shows other people's games — and the menu on those rows offered to edit and
 * to clear their LP. The server refuses both with not_your_account, so the only
 * thing that reached the user was a 403 they had no way to interpret.
 *
 * Absent means local-only, where every account in the file is yours.
 */
describe('LP editing and whose account it is', () => {
  const RANKED_UNATTRIBUTED: MatchSummary = { ...MATCH, rank: null, hasManualRank: false }

  function labelled(items: ReturnType<typeof matchContextItems>, prefix: string) {
    return items.find((item) => item.label.startsWith(prefix))
  }

  it('offers the edit on an account you claimed', () => {
    const items = matchContextItems(RANKED_UNATTRIBUTED, NOTHING, { isMine: true })

    expect(labelled(items, 'Edit LP gain')?.disabledReason).toBeUndefined()
  })

  it('offers the edit in local-only mode, where the question does not arise', () => {
    const items = matchContextItems(RANKED_UNATTRIBUTED, NOTHING)

    expect(labelled(items, 'Edit LP gain')?.disabledReason).toBeUndefined()
  })

  it('refuses the edit on somebody else account, and says why', () => {
    const items = matchContextItems(RANKED_UNATTRIBUTED, NOTHING, { isMine: false })

    expect(labelled(items, 'Edit LP gain')?.disabledReason).toBe(
      'Only whoever claimed this account can type its LP'
    )
  })

  it('gives ownership as the reason ahead of anything about the game', () => {
    // A remake on somebody else's account is both. "Remakes move no LP" is
    // true and useless — it suggests a different game would work.
    const items = matchContextItems(
      { ...RANKED_UNATTRIBUTED, isRemake: true },
      NOTHING,
      { isMine: false }
    )

    expect(labelled(items, 'Edit LP gain')?.disabledReason).toBe(
      'Only whoever claimed this account can type its LP'
    )
  })

  it('refuses clearing somebody else hand-entered figure', () => {
    // The path that had no check at all: hasManualRank swapped the item for
    // "Clear LP edit" and never asked whose it was.
    const items = matchContextItems(
      { ...MATCH, hasManualRank: true },
      NOTHING,
      { isMine: false }
    )

    expect(labelled(items, 'Clear LP edit')?.disabledReason).toBe(
      'Only whoever claimed this account can type its LP'
    )
  })

  it('still offers clearing your own', () => {
    const items = matchContextItems({ ...MATCH, hasManualRank: true }, NOTHING, { isMine: true })

    expect(labelled(items, 'Clear LP edit')?.disabledReason).toBeUndefined()
  })
})

/**
 * What the menu offers depends on what the platform can do.
 *
 * The same row renders in the desktop and in a browser, and a browser can open
 * no recording and launch no League client. An item it can never act on would
 * sit greyed out on every row forever, so an action the platform did not
 * supply is not offered at all.
 */
describe('matchContextItems on a platform that cannot do everything', () => {
  const EVERYWHERE = { onCopyId: () => {}, onOpenDetails: () => {} }
  const labels = (actions: Parameters<typeof matchContextItems>[1], match = MATCH): string[] =>
    matchContextItems(match, actions).map((item) => item.label)

  it('offers only what works everywhere when that is all it was given', () => {
    expect(labels(EVERYWHERE)).toEqual(['Copy match ID', 'Open match details'])
  })

  it('offers a download without the two ways to watch, as a browser would', () => {
    const shared = { ...MATCH, sharedReplay: { patch: '15.14', fileBytes: 31_000_000 } }

    expect(labels({ ...EVERYWHERE, onDownloadReplay: () => {} }, shared)).toEqual([
      'Download replay (patch 15.14)',
      'Copy match ID',
      'Open match details'
    ])
  })

  it('offers LP editing wherever there is somewhere to edit it', () => {
    expect(labels({ ...EVERYWHERE, onEditLp: () => {} })).toContain('Edit LP gain…')
    expect(labels({ ...EVERYWHERE, onClearLp: () => {} }, { ...MATCH, hasManualRank: true })).toContain(
      'Clear LP edit'
    )
  })

  it('puts both ways to watch back when the platform can do both', () => {
    const all = labels({ ...EVERYWHERE, onWatchRecording: () => {}, onWatchReplay: () => {} })
    expect(all.slice(0, 2)).toEqual(['Watch recording', 'Watch replay'])
  })

  it('offers a link to the game only where there is a web client to open it in', () => {
    expect(labels(EVERYWHERE)).not.toContain('Copy link')
    expect(labels({ ...EVERYWHERE, onCopyLink: () => {} })).toEqual([
      'Copy link',
      'Copy match ID',
      'Open match details'
    ])
  })
})
