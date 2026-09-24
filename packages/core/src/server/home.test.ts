import { describe, expect, it } from 'vitest'
import type { Account } from '../types'
import { homeAmong, markHome } from './home'

function account(id: string): Account {
  return {
    id,
    puuid: `p-${id}`,
    gameName: `Player${id}`,
    tagLine: 'NA1',
    platform: 'na1',
    regionalRoute: 'americas',
    summonerId: null,
    profileIconId: null,
    summonerLevel: null,
    isHomeAccount: false,
    createdAt: '',
    updatedAt: '',
    isMine: true
  }
}

const home = (accounts: Account[]) => accounts.filter((a) => a.isHomeAccount).map((a) => a.id)

describe('homeAmong', () => {
  it('is the remembered account when it is one of yours', () => {
    expect(homeAmong([account('a'), account('b')], 'b')?.id).toBe('b')
  })

  it('is your first when nothing is remembered, so a new server opens somewhere', () => {
    expect(homeAmong([account('a'), account('b')], null)?.id).toBe('a')
  })

  it("is none of yours when the remembered one is not yours — a friend's, starred in a browser", () => {
    expect(homeAmong([account('a'), account('b')], 'friend')).toBeNull()
  })

  it('is nobody when nothing is yours, rather than a stranger', () => {
    expect(homeAmong([], null)).toBeNull()
  })
})

describe('markHome', () => {
  it('marks exactly one account, and never mutates the list it was given', () => {
    const accounts = [account('a'), account('b')]
    const stamped = markHome(accounts, null)

    expect(home(stamped)).toEqual(['a'])
    expect(accounts.every((a) => !a.isHomeAccount)).toBe(true)
  })

  it('marks none when home is somebody else', () => {
    expect(home(markHome([account('a'), account('b')], 'friend'))).toEqual([])
  })
})
