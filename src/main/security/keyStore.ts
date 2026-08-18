import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'

// The Riot key is deliberately kept out of the SQLite DB so the database file
// can be copied/inspected without leaking a credential. safeStorage binds the
// ciphertext to the OS user account (DPAPI on Windows).

function secureDir(): string {
  return join(app.getPath('userData'), 'secure')
}

function keyPath(): string {
  return join(secureDir(), 'riot-api-key.enc')
}

export function saveApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) throw new Error('API key cannot be empty')

  mkdirSync(secureDir(), { recursive: true })

  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(keyPath(), safeStorage.encryptString(trimmed))
  } else {
    // OS keychain unavailable — store plaintext but make the downgrade explicit
    // rather than silently pretending the key is encrypted.
    writeFileSync(keyPath(), Buffer.from(`plain:${trimmed}`, 'utf8'))
  }
}

export function loadApiKey(): string | null {
  const path = keyPath()
  if (!existsSync(path)) return null

  try {
    const buf = readFileSync(path)
    const asText = buf.toString('utf8')
    if (asText.startsWith('plain:')) return asText.slice('plain:'.length)
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(buf)
  } catch {
    // Corrupt or written under a different OS user — treat as missing so the
    // user is prompted to re-enter rather than crashing at startup.
    return null
  }
}

export function clearApiKey(): void {
  const path = keyPath()
  if (existsSync(path)) rmSync(path)
}

export function hasStoredApiKey(): boolean {
  return loadApiKey() !== null
}

/**
 * A second credential store, for secrets that are not the Riot key.
 *
 * The obs-websocket password is the first of them. It goes here rather than in
 * `app_settings` for the same reason the Riot key does: the database file is
 * something a user might reasonably copy or hand over when reporting a problem,
 * and it should not carry a password when they do.
 */
function secretPath(name: string): string {
  // Named rather than pathed by the caller, so nothing can write outside
  // `secure/` by passing a traversing name.
  return join(secureDir(), `${name.replace(/[^a-z0-9._-]/gi, '_')}.enc`)
}

export function saveSecret(name: string, value: string): void {
  const trimmed = value.trim()
  if (!trimmed) {
    clearSecret(name)
    return
  }

  mkdirSync(secureDir(), { recursive: true })

  if (safeStorage.isEncryptionAvailable()) {
    writeFileSync(secretPath(name), safeStorage.encryptString(trimmed))
  } else {
    writeFileSync(secretPath(name), Buffer.from(`plain:${trimmed}`, 'utf8'))
  }
}

export function loadSecret(name: string): string | null {
  const path = secretPath(name)
  if (!existsSync(path)) return null

  try {
    const buf = readFileSync(path)
    const asText = buf.toString('utf8')
    if (asText.startsWith('plain:')) return asText.slice('plain:'.length)
    if (!safeStorage.isEncryptionAvailable()) return null
    return safeStorage.decryptString(buf)
  } catch {
    return null
  }
}

export function clearSecret(name: string): void {
  const path = secretPath(name)
  if (existsSync(path)) rmSync(path)
}

export function hasSecret(name: string): boolean {
  return existsSync(secretPath(name))
}
