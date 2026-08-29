/**
 * Integration checks for the settings write path, against a real sqlite
 * database in a throwaway userData directory.
 *
 * Separate from check-settings.cjs because this one must run under Electron:
 * `db/database.ts` imports `electron` for `app.getPath('userData')`. Run it
 * with `npm run check:settings:db`.
 *
 * The case worth protecting here is the secret exemption. `coerceSettingValue`
 * refuses `kind: 'secret'` so the *agent* cannot set a credential, but the
 * Settings UI writes API keys through the very same `setSetting`. Guard the
 * whole table uniformly and saving an API key breaks — which a pure unit test
 * of the shared modules would never catch.
 */
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.join(__dirname, '..')
// The npm script compiles with plain tsc before invoking Electron. Doing the
// compile here instead would spawn it via `process.execPath`, which under
// Electron is the Electron binary rather than node — that launches a second
// Electron app instead of tsc, and hangs.
const OUT = path.join(ROOT, '.settings-check')
if (!fs.existsSync(path.join(OUT, 'main/db/queries.js'))) {
  console.error('Compiled output missing. Run via `npm run check:settings:db`.')
  process.exit(1)
}

const { app } = require('electron')

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'check-settings-userdata-'))
app.setPath('userData', SANDBOX)

const Q = require(path.join(OUT, 'main/db/queries.js'))

let pass = 0
let fail = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(
    (ok ? 'PASS ' : 'FAIL ') +
      name +
      (ok ? '' : ` -> got ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`)
  )
}

app.whenReady().then(() => {
  // ── Secrets must remain writable by the UI ──
  Q.setSetting('anthropicApiKey', JSON.stringify('sk-ant-test-value'))
  check('API key saves', Q.getDecodedSetting('anthropicApiKey'), 'sk-ant-test-value')
  Q.setSetting('elevenLabsApiKey', JSON.stringify('sk_eleven'))
  check('second API key saves', Q.getDecodedSetting('elevenLabsApiKey'), 'sk_eleven')

  // googleTokens is a JSON object written by googleAuth, not a string.
  Q.setSetting('googleTokens', JSON.stringify({ refresh_token: 'r', access_token: 'a' }))
  check('googleTokens round-trips', Q.getSetting('googleTokens'), '{"refresh_token":"r","access_token":"a"}')

  // ── Validation still bites ──
  Q.setSetting('voiceId', JSON.stringify('zenya'))
  check('voice name coerced to id', Q.getDecodedSetting('voiceId'), 'f5iYMGdlB5CJwK2vhzsS')

  let e1 = null
  try {
    Q.setSetting('voiceId', JSON.stringify('bartholomew'))
  } catch (e) {
    e1 = e
  }
  check('bad voice throws', e1 && e1.name, 'InvalidSettingError')
  check('bad voice leaves previous intact', Q.getDecodedSetting('voiceId'), 'f5iYMGdlB5CJwK2vhzsS')

  Q.setSetting('theme', JSON.stringify('Frutiger Aero'))
  check('theme display name coerced', Q.getDecodedSetting('theme'), 'aero')

  let e2 = null
  try {
    Q.setSetting('personalityMode', JSON.stringify('chaotic'))
  } catch (e) {
    e2 = e
  }
  check('bad enum throws', e2 && e2.name, 'InvalidSettingError')
  check('bad enum error lists options', /standard/.test(e2 ? e2.message : ''), true)

  let e3 = null
  try {
    Q.setSetting('showFurigana', JSON.stringify('yes'))
  } catch (e) {
    e3 = e
  }
  check('non-bool toggle throws', e3 && e3.name, 'InvalidSettingError')

  Q.setSetting('ttsStability', JSON.stringify(5))
  check('number clamped on save', Q.getDecodedSetting('ttsStability'), '1')

  // japaneseLevel must stay a number, or the renderer's `=== 2` stops matching.
  Q.setSetting('japaneseLevel', JSON.stringify(2))
  check('numeric enum stays numeric', Q.getSetting('japaneseLevel'), '2')

  // ── The leak this change closes ──
  const all = Q.getAllDecodedSettings()
  check('secret reduced to boolean', all.anthropicApiKey, true)
  check('googleTokens reduced to boolean', all.googleTokens, true)
  check('secret value never present', JSON.stringify(all).includes('sk-ant-test-value'), false)
  check('refresh token never present', JSON.stringify(all).includes('refresh_token'), false)
  check('non-secret decoded normally', all.theme, 'aero')

  console.log(`\n${pass} passed, ${fail} failed`)

  // Best-effort only. The database is still open in WAL mode, and on Windows
  // removing its directory here blocks instead of failing — which hangs the
  // run after every assertion has already passed. The sandbox is under the
  // OS temp directory, so leaving it is harmless.
  try {
    fs.rmSync(SANDBOX, { recursive: true, force: true })
  } catch {
    /* ignore */
  }

  app.exit(fail ? 1 : 0)
})
