import { describe, expect, it } from 'vitest'
import { displayName, inviteTokenFrom, normaliseServerUrl } from './url'

function ok(raw: string): string {
  const result = normaliseServerUrl(raw)
  if ('error' in result) throw new Error(`expected "${raw}" to be accepted, got: ${result.error}`)
  return result.url
}

function rejected(raw: string): string {
  const result = normaliseServerUrl(raw)
  if (!('error' in result)) throw new Error(`expected "${raw}" to be refused, got: ${result.url}`)
  return result.error
}

describe('normaliseServerUrl', () => {
  it('assumes https for a bare host', () => {
    // What somebody copies out of a Discord message. Making them type a scheme
    // teaches them nothing.
    expect(ok('foxfire.example.com')).toBe('https://foxfire.example.com')
  })

  it('keeps a port', () => {
    expect(ok('foxfire.example.com:8443')).toBe('https://foxfire.example.com:8443')
  })

  it('drops a trailing slash so two spellings are one server', () => {
    expect(ok('https://foxfire.example.com/')).toBe('https://foxfire.example.com')
  })

  it('drops a path, because a server lives at its root', () => {
    // The likeliest paste is an invite link. Keeping its path would send every
    // later request somewhere that does not answer.
    expect(ok('https://foxfire.example.com/invite/abc.def')).toBe('https://foxfire.example.com')
  })

  it('tolerates whitespace and case', () => {
    expect(ok('  HTTPS://Foxfire.Example.COM  ')).toBe('https://foxfire.example.com')
  })

  it.each(['localhost:8080', 'http://localhost:8080', '127.0.0.1:8080', 'http://[::1]:8080'])(
    'allows http for loopback (%s)',
    (raw) => {
      expect(ok(raw)).toMatch(/^http:\/\//)
    }
  )

  it('assumes https for a bare host that merely mentions localhost', () => {
    // Not loopback: a real host somebody could route anywhere.
    expect(ok('localhost.example.com')).toBe('https://localhost.example.com')
  })

  it.each(['http://foxfire.example.com', 'http://192.168.1.50:8080'])(
    'refuses plain http off this machine (%s)',
    (raw) => {
      expect(rejected(raw)).toContain('not https')
    }
  )

  it.each(['ftp://foxfire.example.com', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'refuses anything that is not http or https (%s)',
    (raw) => {
      expect(rejected(raw)).toBeTruthy()
    }
  )

  it.each(['', '   '])('refuses nothing at all (%s)', (raw) => {
    expect(rejected(raw)).toContain('Enter the address')
  })

  it('refuses something that is not an address', () => {
    expect(rejected('not a url at all')).toBeTruthy()
  })
})

describe('inviteTokenFrom', () => {
  const token = 'QbGgAX5_snuoIQKRWXw1EQAAAABqvs9-.K8nkbyg6mVzANgvRHI7L2RS2JaXxPzmfM6HRZ1-1H5U'

  it('takes the code when the code is what was pasted', () => {
    expect(inviteTokenFrom(token)).toBe(token)
  })

  it('takes the code out of the whole link', () => {
    // They are handed a link and told to paste a code, so they will paste both.
    expect(inviteTokenFrom(`https://foxfire.example.com/invite/${token}`)).toBe(token)
  })

  it('survives the angle brackets a chat client wraps links in', () => {
    expect(inviteTokenFrom(`<https://foxfire.example.com/invite/${token}>`)).toBe(token)
  })

  it('trims', () => {
    expect(inviteTokenFrom(`  ${token}  `)).toBe(token)
  })

  it('is empty for nothing', () => {
    expect(inviteTokenFrom('')).toBe('')
    expect(inviteTokenFrom('   ')).toBe('')
  })
})

describe('displayName', () => {
  it('is the host', () => {
    expect(displayName('https://foxfire.example.com')).toBe('foxfire.example.com')
    expect(displayName('http://localhost:8080')).toBe('localhost:8080')
  })

  it('falls back to whatever it was given', () => {
    expect(displayName('nonsense')).toBe('nonsense')
  })
})
