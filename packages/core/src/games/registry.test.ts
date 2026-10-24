import { describe, expect, it } from 'vitest'
import {
  GAMES,
  GAME_IDS,
  gameOfLiveSession,
  gameOfQueueId,
  parseGameId,
  queueDefinition,
  queueFolder
} from './registry'
import { LADDERS, LADDER_IDS, isLadderId, ladderOfParam, ladderOfQueueId, laddersOf } from './ladders'
import {
  DEFAULT_QUEUE_FILTER,
  QUEUE_FILTER_OPTIONS,
  TRACKED_QUEUES,
  isRankedQueue,
  queueFilterLabel,
  queueFilterOptions,
  queueIdForQueueType,
  queueTypeForQueueId
} from '../rules/queues'

describe('the registry', () => {
  it('never gives two games the same queue id', () => {
    const ids = GAME_IDS.flatMap((game) => GAMES[game].queues.map((q) => q.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('files every queue under a folder Windows can hold', () => {
    for (const game of GAME_IDS) {
      expect(GAMES[game].folder).toMatch(/^[A-Za-z0-9-]+$/)
      for (const q of GAMES[game].queues) expect(q.folder).toMatch(/^[A-Za-z0-9-]+$/)
    }
  })

  it('files a queue nobody has named under Other, and never under the wrong game', () => {
    expect(queueFolder('lol', 420)).toBe('Solo-Duo')
    expect(queueFolder('tft', 1100)).toBe('Ranked')
    expect(queueFolder('tft', 1160)).toBe('Double-Up')
    expect(queueFolder('lol', 9999)).toBe('Other')
    expect(queueFolder('lol', null)).toBe('Other')
    expect(queueFolder('tft', 420)).toBe('Other')
  })

  it('knows which game a queue belongs to, and says nothing about one it has never heard of', () => {
    expect(gameOfQueueId(420)).toBe('lol')
    expect(gameOfQueueId(1100)).toBe('tft')
    expect(gameOfQueueId(6000)).toBeNull()
    expect(gameOfQueueId(null)).toBeNull()
    expect(queueDefinition(1130)?.label).toBe('Hyper Roll')
  })

  it('reads TFT off the client session by mode or map before the queue', () => {
    expect(gameOfLiveSession({ queueId: 1100 })).toBe('tft')
    expect(gameOfLiveSession({ queueId: 6000, gameMode: 'TFT' })).toBe('tft')
    expect(gameOfLiveSession({ queueId: 6000, mapId: 22 })).toBe('tft')
    expect(gameOfLiveSession({ queueId: 420, gameMode: 'CLASSIC', mapId: 11 })).toBe('lol')
    expect(gameOfLiveSession({ queueId: 6000 })).toBe('lol')
    expect(gameOfLiveSession({})).toBe('lol')
  })

  it('reads a game from a URL or a request, and nothing else', () => {
    expect(parseGameId('tft')).toBe('tft')
    expect(parseGameId('lol')).toBe('lol')
    expect(parseGameId('TFT')).toBeUndefined()
    expect(parseGameId(undefined)).toBeUndefined()
  })

  it('waits longer for a TFT match, which publishes only when the lobby is done', () => {
    expect(GAMES.tft.bindGiveUpMs).toBeGreaterThan(GAMES.lol.bindGiveUpMs)
    const total = (ms: readonly number[]) => ms.reduce((a, b) => a + b, 0)
    expect(total(GAMES.tft.postGameRetryMs)).toBeGreaterThan(total(GAMES.lol.postGameRetryMs))
  })
})

describe('the ladders', () => {
  it('belong to their games, League first', () => {
    expect(laddersOf('lol')).toEqual(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'])
    expect(laddersOf('tft')).toEqual(['RANKED_TFT', 'RANKED_TFT_DOUBLE_UP', 'RANKED_TFT_TURBO'])
    expect(LADDER_IDS.every((id) => LADDERS[id].id === id)).toBe(true)
  })

  it('round-trip through queue ids and URL params', () => {
    for (const id of LADDER_IDS) {
      expect(ladderOfQueueId(LADDERS[id].queueId)).toBe(id)
      expect(ladderOfParam(LADDERS[id].urlParam)).toBe(id)
      expect(isLadderId(id)).toBe(true)
    }
    expect(ladderOfQueueId(1090)).toBeNull()
    expect(isLadderId('RANKED_TFT_PAIRS')).toBe(false)
    // What every object inherits is not a ladder.
    expect(isLadderId('toString')).toBe(false)
    expect(isLadderId('constructor')).toBe(false)
  })

  it('makes Hyper Roll the rated one, and keeps it out of the LP editor', () => {
    expect(LADDERS.RANKED_TFT_TURBO.scale).toBe('rated')
    expect(LADDERS.RANKED_TFT_TURBO.lpEditable).toBe(false)
    expect(LADDER_IDS.filter((id) => LADDERS[id].scale === 'rated')).toEqual(['RANKED_TFT_TURBO'])
  })

  it('places Double Up by team, four to a lobby', () => {
    expect(LADDERS.RANKED_TFT_DOUBLE_UP.placementSlots).toBe(4)
    expect(LADDERS.RANKED_TFT.placementSlots).toBe(8)
  })
})

describe("League's answers, from before there were two games", () => {
  it('offers the same filter, in the same order', () => {
    expect(QUEUE_FILTER_OPTIONS).toEqual([
      { value: null, label: 'All Queues' },
      { value: 420, label: 'Ranked Solo/Duo' },
      { value: 440, label: 'Ranked Flex' },
      { value: 400, label: 'Normal Draft' },
      { value: 430, label: 'Normal Blind' },
      { value: 450, label: 'ARAM' },
      { value: 1700, label: 'Arena' }
    ])
    expect(DEFAULT_QUEUE_FILTER).toBe(420)
  })

  it('tracks the same two ladders, and maps them the same way', () => {
    expect(TRACKED_QUEUES).toEqual(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'])
    expect(queueTypeForQueueId(420)).toBe('RANKED_SOLO_5x5')
    expect(queueTypeForQueueId(440)).toBe('RANKED_FLEX_SR')
    expect(queueTypeForQueueId(450)).toBeNull()
    expect(queueTypeForQueueId(null)).toBeNull()
    expect(queueIdForQueueType('RANKED_SOLO_5x5')).toBe(420)
    expect(queueIdForQueueType('RANKED_FLEX_SR')).toBe(440)
    expect(queueFilterLabel(420)).toBe('Ranked Solo/Duo')
    expect(queueFilterLabel(null)).toBe('All Queues')
  })
})

describe('TFT through the same helpers', () => {
  it('has its own filter, opening on every queue', () => {
    expect(queueFilterOptions('tft').map((o) => o.value)).toEqual([null, 1100, 1160, 1130, 1090])
    expect(GAMES.tft.defaultQueueFilter).toBeNull()
  })

  it('maps its ladders without falling through to Flex', () => {
    expect(queueIdForQueueType('RANKED_TFT')).toBe(1100)
    expect(queueIdForQueueType('RANKED_TFT_DOUBLE_UP')).toBe(1160)
    expect(queueIdForQueueType('RANKED_TFT_TURBO')).toBe(1130)
    expect(queueTypeForQueueId(1100)).toBe('RANKED_TFT')
    expect(isRankedQueue(1090)).toBe(false)
    expect(queueFilterLabel(1160)).toBe('Double Up')
  })
})
