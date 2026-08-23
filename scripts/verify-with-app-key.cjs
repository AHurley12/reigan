/**
 * Runs the Phase 0 probes using the key already stored in the app's Settings,
 * so there is nothing to re-enter and no second place to keep a key in sync.
 *
 * Run:  npx electron scripts/verify-with-app-key.cjs
 *
 * The stored key is DPAPI-encrypted through Electron's safeStorage (db/secrets.ts),
 * which means only an Electron process can decrypt it — hence this wrapper rather
 * than plain `node`. The key is decrypted in memory, handed to the probes via
 * process.env, and never printed, logged, or written to disk.
 */

const path = require('node:path')
const { app, safeStorage } = require('electron')

const ENC_PREFIX = 'enc:v1:'

function fail(message) {
  console.error(message)
  app.exit(1)
}

app.whenReady().then(async () => {
  // Launched as a bare script, Electron would default userData to %APPDATA%/Electron.
  // Point it at the real app directory so we read the same reigan.db the app uses.
  const dbPath = path.join(app.getPath('appData'), 'reigan', 'reigan.db')

  let Database
  try {
    Database = require('better-sqlite3')
  } catch (err) {
    return fail(`Could not load better-sqlite3: ${err.message}\nRun \`npm run postinstall\` to rebuild native modules for Electron.`)
  }

  let row
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true })
    row = db.prepare("SELECT value FROM settings WHERE key = 'anthropicApiKey'").get()
    db.close()
  } catch (err) {
    return fail(`Could not open ${dbPath}: ${err.message}`)
  }

  if (!row || !row.value) {
    return fail('No Anthropic API key saved. Open the app, press Ctrl+, and paste your key into Settings → General.')
  }

  // Mirrors decryptSecret() + getDecodedSetting() from db/secrets.ts and db/queries.ts:
  // rows written before encryption shipped pass through as plaintext, and renderer-written
  // rows are JSON-encoded, so strip the wrapping quotes if present.
  let value = row.value
  if (value.startsWith(ENC_PREFIX)) {
    if (!safeStorage.isEncryptionAvailable()) {
      return fail('The stored key is encrypted but the OS keyring is unavailable, so it cannot be decrypted.')
    }
    try {
      value = safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
    } catch (err) {
      return fail(`Failed to decrypt the stored key: ${err.message}`)
    }
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === 'string') value = parsed
  } catch {
    // Legacy unquoted row — use as-is.
  }

  if (!value.trim()) {
    return fail('The stored Anthropic API key is empty.')
  }

  console.log(`Using the key saved in Settings (${value.slice(0, 7)}…, ${value.length} chars). It is not printed or written anywhere.\n`)
  process.env.ANTHROPIC_API_KEY = value

  // The probe script exits the process itself with its own pass/fail status.
  await import(new URL('./verify-context-management.mjs', require('node:url').pathToFileURL(__filename)).href)
})
