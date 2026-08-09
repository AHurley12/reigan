import { safeStorage } from 'electron'
import type Database from 'better-sqlite3'

/**
 * OS-backed encryption at rest for the handful of settings rows that are
 * credentials rather than preferences.
 *
 * Before this, every secret the app holds sat in plaintext in
 * `%APPDATA%/reigan/reigan.db` — three API keys, the Google client secret, and
 * the full OAuth token blob including the *refresh* token. Anything able to
 * read the user's profile directory had durable access to their Gmail and
 * Calendar. On Windows, safeStorage is DPAPI-backed and scoped to the user
 * account, so the ciphertext is useless when copied to another machine.
 *
 * Values are stored as `enc:v1:<base64>`. Reads accept either form, so a
 * database written by an older build keeps working and is upgraded in place by
 * `migrateSecretsToSafeStorage()` on the next boot.
 */

const ENC_PREFIX = 'enc:v1:'

/**
 * Setting keys treated as credentials.
 *
 * `googleClientId` is deliberately absent: it is transmitted in the consent URL
 * and is not a secret. Encrypting it would imply a confidentiality guarantee
 * that OAuth itself does not make.
 */
export const SECRET_SETTING_KEYS = new Set([
  'anthropicApiKey',
  'deepgramApiKey',
  'elevenLabsApiKey',
  'googleClientSecret',
  'googleTokens',
])

export function isSecretKey(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key)
}

function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX)
}

/**
 * Encrypts a secret value for storage. Falls back to plaintext when the OS
 * keyring is unavailable (headless Linux without libsecret, for instance) —
 * degrading to today's behaviour is better than refusing to save the user's key,
 * but callers should surface `isEncryptionAvailable()` in the UI so the user
 * knows which they're getting.
 */
export function encryptSecret(value: string): string {
  if (value === '') return ''
  if (!safeStorage.isEncryptionAvailable()) return value
  return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
}

/** Decrypts a stored value, passing through anything not in encrypted form. */
export function decryptSecret(value: string): string {
  if (!isEncrypted(value)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    // Wrong OS user, migrated profile, or a corrupt blob. Report as absent
    // rather than throwing: the caller's "not configured" path is a far better
    // experience than a hard crash on every read of a key we can't recover.
    return ''
  }
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

/**
 * One-time upgrade of plaintext credential rows written by earlier builds.
 *
 * Must run after `app.whenReady()` — safeStorage has no keyring before then.
 * Idempotent: already-encrypted rows are skipped, so this is safe on every boot.
 */
export function migrateSecretsToSafeStorage(db: Database.Database): number {
  if (!safeStorage.isEncryptionAvailable()) return 0

  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string
    value: string
  }>

  const update = db.prepare('UPDATE settings SET value = ? WHERE key = ?')
  let migrated = 0

  const run = db.transaction(() => {
    for (const row of rows) {
      if (!isSecretKey(row.key)) continue
      if (row.value === '' || isEncrypted(row.value)) continue
      update.run(encryptSecret(row.value), row.key)
      migrated += 1
    }
  })
  run()

  return migrated
}
