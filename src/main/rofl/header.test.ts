import { describe, expect, it } from 'vitest'
import { parseRoflHeader } from './header'

/**
 * A synthetic .rofl, built to the layout Riot documents by shipping it.
 *
 * Written rather than committed as a binary fixture so the offsets under test
 * are visible: a checked-in blob would prove the parser reads that one file and
 * explain nothing about why.
 */
function buildRofl(
  metadata: unknown,
  { magic = 'RIOT', corruptOffsets = false } = {}
): Uint8Array {
  const blob = Buffer.from(JSON.stringify(metadata), 'utf8')

  const head = Buffer.alloc(288)
  head.write(magic, 0, 'latin1')
  head.writeUInt16LE(0, 4)
  // 6..262 is the signature; zeroes are fine, nothing reads it.
  head.writeUInt16LE(288, 262)
  head.writeUInt32LE(288 + blob.length, 264)
  head.writeUInt32LE(corruptOffsets ? 0xffffff : 288, 268)
  head.writeUInt32LE(corruptOffsets ? 0xffffff : blob.length, 272)

  return Uint8Array.from(Buffer.concat([head, blob]))
}

const PLAYERS = [
  {
    NAME: 'Faker',
    RIOT_ID_GAME_NAME: 'Hide on bush',
    SKIN: 'Ahri',
    CHAMPIONS_KILLED: '7',
    NUM_DEATHS: '2',
    ASSISTS: '11',
    ITEM0: '3157',
    ITEM1: '6655',
    ITEM2: '0',
    WIN: 'Win'
  },
  { NAME: 'Someone', SKIN: 'MonkeyKing', CHAMPIONS_KILLED: '3', WIN: 'Fail' }
]

const METADATA = {
  gameLength: 1_834_000,
  gameVersion: '15.16.700.1234',
  statsJson: JSON.stringify(PLAYERS)
}

describe('parseRoflHeader', () => {
  it('reads version, duration and the scoreboard', () => {
    const header = parseRoflHeader(buildRofl(METADATA))

    expect(header).not.toBeNull()
    expect(header?.gameVersion).toBe('15.16.700.1234')
    expect(header?.durationSeconds).toBe(1834)
    expect(header?.players).toHaveLength(2)
  })

  it('prefers the Riot ID over the legacy name', () => {
    const player = parseRoflHeader(buildRofl(METADATA))?.players[0]
    expect(player?.name).toBe('Hide on bush')
    expect(player?.championName).toBe('Ahri')
  })

  it('turns the stringified numbers into numbers', () => {
    const player = parseRoflHeader(buildRofl(METADATA))?.players[0]
    expect(player).toMatchObject({ kills: 7, deaths: 2, assists: 11 })
  })

  it('drops empty item slots rather than recording them as item 0', () => {
    expect(parseRoflHeader(buildRofl(METADATA))?.players[0]?.items).toEqual([3157, 6655])
  })

  it('reads both spellings of a win', () => {
    const players = parseRoflHeader(buildRofl(METADATA))?.players
    expect(players?.[0]?.win).toBe(true)
    expect(players?.[1]?.win).toBe(false)
  })

  it('finds the metadata by scanning when the offset table is wrong', () => {
    // The whole point of the fallback: Riot moves the header, the blob is still
    // in the file, and the replay keeps its patch.
    const header = parseRoflHeader(buildRofl(METADATA, { corruptOffsets: true }))
    expect(header?.gameVersion).toBe('15.16.700.1234')
    expect(header?.players).toHaveLength(2)
  })

  it('degrades to nulls rather than throwing when fields are missing', () => {
    const header = parseRoflHeader(buildRofl({ gameLength: 0 }))
    expect(header).not.toBeNull()
    expect(header?.gameVersion).toBeNull()
    expect(header?.durationSeconds).toBeNull()
    expect(header?.players).toEqual([])
  })

  it('survives a statsJson that is not valid JSON', () => {
    const header = parseRoflHeader(buildRofl({ gameLength: 1000, statsJson: 'not json' }))
    expect(header?.players).toEqual([])
    expect(header?.durationSeconds).toBe(1)
  })

  it('rejects a file that is not a replay at all', () => {
    expect(parseRoflHeader(buildRofl(METADATA, { magic: 'MP4 ' }))).toBeNull()
    expect(parseRoflHeader(Uint8Array.from([1, 2, 3]))).toBeNull()
    expect(parseRoflHeader(new Uint8Array(0))).toBeNull()
  })

  it('rejects a replay whose metadata never arrived', () => {
    // A part-downloaded file: the magic is there, the blob is not. This is the
    // check that keeps the watcher from ingesting a file still being written.
    const truncated = buildRofl(METADATA).slice(0, 200)
    expect(parseRoflHeader(truncated)).toBeNull()
  })
})

/**
 * A synthetic ROFL2, the container Riot ships today.
 *
 * Three things differ from v1 and every one of them broke the first parser: the
 * version is a length-prefixed string in the header rather than a field in the
 * blob, the offset table does not describe the metadata, and the blob is at the
 * very end of the file instead of near the front.
 */
function buildRofl2(
  metadata: unknown,
  { version = '16.16.804.9184', padding = 4096 } = {}
): { head: Uint8Array; tail: Uint8Array } {
  const blob = Buffer.from(JSON.stringify(metadata), 'utf8')

  const header = Buffer.alloc(15 + version.length)
  header.write('RIOT', 0, 'latin1')
  header.writeUInt16LE(2, 4)
  // 6..13 is an eight-byte identifier nothing here reads.
  header.writeUInt8(version.length, 14)
  header.write(version, 15, 'latin1')

  // Stands in for the compressed replay: bytes that mean nothing to us and
  // guarantee the metadata is nowhere near the front.
  const payload = Buffer.alloc(padding, 0xab)

  const whole = Buffer.concat([header, payload, blob])
  return { head: Uint8Array.from(whole.subarray(0, 512)), tail: Uint8Array.from(whole.subarray(-2048)) }
}

const V2_METADATA = {
  gameLength: 1_681_895,
  lastGameChunkId: 40,
  lastKeyFrameId: 20,
  // v2 leaves NAME empty and carries the handle in RIOT_ID_GAME_NAME.
  statsJson: JSON.stringify([
    {
      NAME: '',
      RIOT_ID_GAME_NAME: 'drd',
      SKIN: 'DrMundo',
      CHAMPIONS_KILLED: '3',
      NUM_DEATHS: '3',
      ASSISTS: '9',
      ITEM0: '1120',
      ITEM1: '3084',
      TEAM: '100',
      WIN: 'Win'
    }
  ])
}

describe('parseRoflHeader, ROFL2', () => {
  it('reads the version from the header, where v2 keeps it', () => {
    const { head, tail } = buildRofl2(V2_METADATA)
    expect(parseRoflHeader(head, tail)?.gameVersion).toBe('16.16.804.9184')
  })

  it('finds the metadata at the end of the file', () => {
    const { head, tail } = buildRofl2(V2_METADATA)
    const header = parseRoflHeader(head, tail)

    expect(header?.durationSeconds).toBe(1682)
    expect(header?.players).toHaveLength(1)
    expect(header?.players[0]?.championName).toBe('DrMundo')
  })

  it('takes the handle from RIOT_ID_GAME_NAME when NAME is blank', () => {
    const { head, tail } = buildRofl2(V2_METADATA)
    expect(parseRoflHeader(head, tail)?.players[0]?.name).toBe('drd')
  })

  it('still reports the patch when the metadata is out of reach', () => {
    // The blob is past the tail window. The replay is still worth listing, and
    // the patch alone tells the user which client they need.
    const { head } = buildRofl2(V2_METADATA)
    const header = parseRoflHeader(head, new Uint8Array(0))

    expect(header?.gameVersion).toBe('16.16.804.9184')
    expect(header?.durationSeconds).toBeNull()
    expect(header?.players).toEqual([])
  })

  it('does not mistake v1 signature bytes for a version string', () => {
    // Byte 14 is part of the signature in v1. Reading it as a length there would
    // invent a patch and match it against installed clients.
    const v1 = buildRofl(METADATA)
    expect(parseRoflHeader(v1)?.gameVersion).toBe('15.16.700.1234')
  })

  it('rejects a length byte that does not yield a version', () => {
    const { head, tail } = buildRofl2(V2_METADATA, { version: 'not-a-version' })
    // Falls back to the blob, which in v2 carries no version at all.
    expect(parseRoflHeader(head, tail)?.gameVersion).toBeNull()
  })
})
