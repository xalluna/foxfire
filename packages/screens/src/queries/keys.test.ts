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
