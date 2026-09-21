import { describe, expect, it } from 'vitest'
import type { Account } from '../types'
import { applyHomeAccount } from './home'

function account(id: string, isMine?: boolean): Account {
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
    isMine
  }
}

const home = (accounts: Account[]) => accounts.filter((a) => a.isHomeAccount).map((a) => a.id)

describe('applyHomeAccount', () => {
  it('opens on the remembered account whenever it is still there', () => {
    const accounts = [account('a', true), account('b'), account('c')]
    expect(home(applyHomeAccount(accounts, 'c'))).toEqual(['c'])
  })

  it('falls back to an account you have claimed', () => {
    const accounts = [account('a', false), account('b', true)]
    expect(home(applyHomeAccount(accounts, 'gone'))).toEqual(['b'])
  })

  it('opens on somebody on a desktop, where there is always history to look at', () => {
    const accounts = [account('a', false), account('b', false)]
    expect(home(applyHomeAccount(accounts, null))).toEqual(['a'])
  })

  it('opens on nobody for the web client, which would rather show its list of players', () => {
    const accounts = [account('a', false), account('b', false)]
    expect(home(applyHomeAccount(accounts, null, { fallbackToAny: false }))).toEqual([])
  })

  it('marks exactly one account, and never mutates the list it was given', () => {
    const accounts = [account('a', true), account('b', true)]
    const stamped = applyHomeAccount(accounts, null)

    expect(home(stamped)).toEqual(['a'])
    expect(accounts.every((a) => !a.isHomeAccount)).toBe(true)
  })
})
