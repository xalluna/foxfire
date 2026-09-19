import { describe, expect, it } from 'vitest'
import { selfNameSet, toRecordingEvent, toRecordingEvents, type LiveEventDto } from './eventMapping'

const SELF = selfNameSet(['Faker#NA1', 'Faker'])

/** The game clock at the first recorded frame — recording starts a bit in. */
const OFFSET = 40

function event(over: Partial<LiveEventDto> = {}): LiveEventDto {
  return {
    EventID: 12,
    EventName: 'ChampionKill',
    EventTime: 140,
    KillerName: 'Faker',
    VictimName: 'Enemy',
    Assisters: [],
    ...over
  }
}

describe('selfNameSet', () => {
  it('matches a Riot ID by its game-name half, which is what the feed prints', () => {
    const set = selfNameSet(['Faker#NA1'])

    expect(set.has('faker')).toBe(true)
    expect(set.has('faker#na1')).toBe(true)
  })

  it('drops the blanks the game sometimes reports instead of a name', () => {
    const set = selfNameSet(['', '   ', null, undefined, 'Faker'])

    expect(set.size).toBe(1)
    expect(set.has('faker')).toBe(true)
  })
})

describe('toRecordingEvent', () => {
  it('measures video time from the frame recording actually started on', () => {
    const mapped = toRecordingEvent(event({ EventTime: 140 }), SELF, OFFSET)

    // 140s into the game, 40s of which happened before the first frame.
    expect(mapped?.videoTime).toBe(100)
    expect(mapped?.gameTime).toBe(140)
  })

  it('drops an event the footage does not contain', () => {
    // First blood at 0:35, recording began at 0:40 — seeking there shows nothing.
    expect(toRecordingEvent(event({ EventTime: 35 }), SELF, OFFSET)).toBeNull()
  })

  it('reads a kill, and names who died', () => {
    const mapped = toRecordingEvent(event(), SELF, OFFSET)

    expect(mapped?.role).toBe('kill')
    expect(mapped?.label).toBe('Enemy')
  })

  it('reads a death, and names who did it', () => {
    const mapped = toRecordingEvent(
      event({ KillerName: 'Enemy', VictimName: 'Faker' }),
      SELF,
      OFFSET
    )

    expect(mapped?.role).toBe('death')
    expect(mapped?.label).toBe('Enemy')
  })

  it('counts an assist', () => {
    const mapped = toRecordingEvent(
      event({ KillerName: 'Teammate', Assisters: ['Someone', 'Faker'] }),
      SELF,
      OFFSET
    )

    expect(mapped?.role).toBe('assist')
    expect(mapped?.label).toBe('Enemy')
  })

  it('drops a fight the player was not in', () => {
    const mapped = toRecordingEvent(
      event({ KillerName: 'Teammate', VictimName: 'Enemy', Assisters: ['Other'] }),
      SELF,
      OFFSET
    )

    expect(mapped).toBeNull()
  })

  it('keeps a multikill alongside the kills it is made of', () => {
    const mapped = toRecordingEvent(
      event({ EventID: 20, EventName: 'Multikill', KillStreak: 3 }),
      SELF,
      OFFSET
    )

    expect(mapped?.role).toBe('multikill')
    expect(mapped?.label).toBe('3')
  })

  it('ignores somebody else running away with the game', () => {
    const mapped = toRecordingEvent(
      event({ EventName: 'Multikill', KillerName: 'Enemy', KillStreak: 5 }),
      SELF,
      OFFSET
    )

    expect(mapped).toBeNull()
  })

  it.each(['FirstBlood', 'Ace', 'TurretKilled', 'DragonKill', 'BaronKill', 'GameEnd'])(
    'leaves %s off the bar, which is about the player and not the game',
    (EventName) => {
      expect(toRecordingEvent(event({ EventName }), SELF, OFFSET)).toBeNull()
    }
  )

  it('survives a malformed entry rather than failing the whole poll', () => {
    expect(toRecordingEvent({ EventName: 'ChampionKill' }, SELF, OFFSET)).toBeNull()
    expect(toRecordingEvent({ EventID: 1, EventTime: 90 }, SELF, OFFSET)).toBeNull()
    expect(toRecordingEvent({ EventID: null, EventName: null, EventTime: null }, SELF, OFFSET)).toBeNull()
  })

  it('ignores case and stray whitespace in a name', () => {
    const mapped = toRecordingEvent(event({ KillerName: '  faker ' }), SELF, OFFSET)

    expect(mapped?.role).toBe('kill')
  })
})

describe('toRecordingEvents', () => {
  it('returns markers in video order, so the timeline never has to sort', () => {
    const mapped = toRecordingEvents(
      [
        event({ EventID: 3, EventTime: 600 }),
        event({ EventID: 1, EventTime: 140 }),
        event({ EventID: 2, EventTime: 320 })
      ],
      SELF,
      OFFSET
    )

    expect(mapped.map((e) => e.eventId)).toEqual([1, 2, 3])
  })

  it('keeps ids stable across polls, since the feed resends everything each time', () => {
    const feed = [event({ EventID: 1, EventTime: 140 }), event({ EventID: 2, EventTime: 200 })]

    const first = toRecordingEvents(feed, SELF, OFFSET)
    const second = toRecordingEvents([...feed, event({ EventID: 3, EventTime: 260 })], SELF, OFFSET)

    expect(first.map((e) => e.eventId)).toEqual([1, 2])
    expect(second.map((e) => e.eventId)).toEqual([1, 2, 3])
  })

  it('yields nothing for a game the player spent uninvolved', () => {
    const mapped = toRecordingEvents(
      [event({ KillerName: 'A', VictimName: 'B', Assisters: ['C'] })],
      SELF,
      OFFSET
    )

    expect(mapped).toEqual([])
  })
})
