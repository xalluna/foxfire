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
