import { describe, expect, it } from 'vitest'
import { queryKeys } from './keys'

describe('the insights keys', () => {
  it('sit under the admin key, so what clears the admin pages clears them too', () => {
    const admin = queryKeys.admin.all()

    expect(queryKeys.admin.insights('riot', '24h').slice(0, admin.length)).toEqual(admin)
    expect(queryKeys.admin.serverLogs('warning').slice(0, admin.length)).toEqual(admin)
  })

  it('keep each tab and window apart, so switching back is instant', () => {
    expect(queryKeys.admin.insights('riot', '24h')).not.toEqual(queryKeys.admin.insights('riot', '1h'))
    expect(queryKeys.admin.insights('riot', '1h')).not.toEqual(queryKeys.admin.insights('sync', '1h'))
    expect(queryKeys.admin.serverLogs('error')).not.toEqual(queryKeys.admin.serverLogs('warning'))
  })
})

describe('the email keys', () => {
  it('all sit under one email key, so a test send or a cleared suppression refreshes the whole page', () => {
    const email = queryKeys.admin.email()

    expect(email.slice(0, queryKeys.admin.all().length)).toEqual(queryKeys.admin.all())
    expect(queryKeys.admin.emailOverview().slice(0, email.length)).toEqual(email)
    expect(queryKeys.admin.emailLog({ kind: 'invite' }).slice(0, email.length)).toEqual(email)
    expect(queryKeys.admin.emailSuppressions('').slice(0, email.length)).toEqual(email)
  })

  it('keep each set of log filters apart', () => {
    expect(queryKeys.admin.emailLog({ kind: 'invite' })).not.toEqual(queryKeys.admin.emailLog({ status: 'invite' }))
    expect(queryKeys.admin.emailLog({})).toEqual(queryKeys.admin.emailLog({ kind: '', status: '', q: '' }))
  })

  it("keep the member's own address out of the admin pages", () => {
    expect(queryKeys.accountEmail()[0]).not.toEqual(queryKeys.admin.all()[0])
  })
})
