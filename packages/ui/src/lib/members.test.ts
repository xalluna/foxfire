import { describe, expect, it } from 'vitest'
import type { AdminUser } from '@foxfire/core'
import { filterMembers } from './members'

function member(username: string, email: string): AdminUser {
  return {
    id: username,
    username,
    email,
    isAdmin: false,
    isDisabled: false,
    createdAt: '2026-09-01T00:00:00Z',
    linkedRiotAccounts: 0,
    activeSessions: 0,
    passwordReset: null
  }
}

const people = [
  member('Faker', 'faker@example.com'),
  member('Caps', 'rasmus@example.com'),
  member('Perkz', 'luka@example.org')
]

describe('filterMembers', () => {
  it('hands back everybody when nothing is typed', () => {
    expect(filterMembers(people, '')).toHaveLength(3)
    expect(filterMembers(people, '   ')).toHaveLength(3)
  })

  it('matches a name, whatever case it was typed in', () => {
    expect(filterMembers(people, 'fak').map((u) => u.username)).toEqual(['Faker'])
    expect(filterMembers(people, 'PERKZ').map((u) => u.username)).toEqual(['Perkz'])
  })

  it('matches an address, which is often all an admin was given', () => {
    expect(filterMembers(people, 'rasmus').map((u) => u.username)).toEqual(['Caps'])
    expect(filterMembers(people, 'example.org').map((u) => u.username)).toEqual(['Perkz'])
  })

  it('matches part of either, not only the start', () => {
    expect(filterMembers(people, 'ker').map((u) => u.username)).toEqual(['Faker'])
  })

  it('finds nobody rather than everybody when there is no match', () => {
    expect(filterMembers(people, 'nobody')).toEqual([])
  })
})
