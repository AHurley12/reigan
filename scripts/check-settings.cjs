/**
 * Assertions over the shared settings modules.
 *
 * There is no test runner in this repo and adding one is a bigger decision
 * than this change deserves, so this transpiles the shared tree with the
 * project's own tsc and asserts against plain node. That keeps the checks
 * repeatable by anyone (`npm run check:settings`) instead of living in a
 * throwaway scratch file.
 *
 * The shared modules must therefore stay free of `electron` and of any import
 * from `src/main` or `src/renderer`.
 */
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const os = require('os')

const ROOT = path.join(__dirname, '..')
// Not under node_modules/: a git worktree has none of its own and resolves
// packages from the parent checkout, so writing there would fail.
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'check-settings-'))

// Resolved rather than path-joined, for the same reason — node walks up to
// wherever typescript actually lives.
const tscBin = require.resolve('typescript/bin/tsc')
execFileSync(
  process.execPath,
  [
    tscBin,
    'src/shared/settings/describe.ts',
    '--module', 'commonjs',
    '--target', 'es2020',
    '--esModuleInterop',
    '--skipLibCheck',
    // Must match the project's tsconfig: without strictNullChecks a
    // discriminated union like CoerceResult does not narrow, so this compile
    // would disagree with the real build in both directions.
    '--strict',
    '--rootDir', 'src',
    '--outDir', OUT,
  ],
  { cwd: ROOT, stdio: 'inherit' }
)

const D = require(path.join(OUT, 'shared/settings/descriptors.js'))
const { describeSettings } = require(path.join(OUT, 'shared/settings/describe.js'))
const { DEFAULT_SETTINGS } = require(path.join(OUT, 'shared/constants.js'))

let pass = 0
let fail = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log(
    (ok ? 'PASS ' : 'FAIL ') +
      name +
      (ok ? '' : `\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`)
  )
}

// ── Completeness ──────────────────────────────────────────────────────────
// Every key with a default must be described, or the model sees a setting it
// cannot name.
check(
  'every default has a descriptor',
  Object.keys(DEFAULT_SETTINGS).filter((k) => !D.SETTING_DESCRIPTORS[k]),
  []
)

// ── Secrets ───────────────────────────────────────────────────────────────
check('no secret is agent-editable', D.AGENT_EDITABLE_KEYS.filter((k) => D.SECRET_KEYS.has(k)), [])
// The two the old mask missed: encrypted at rest, but visible to the agent.
check('tavilyApiKey masked', D.SECRET_KEYS.has('tavilyApiKey'), true)
check('googleTokens masked', D.SECRET_KEYS.has('googleTokens'), true)
check('anthropicApiKey masked', D.SECRET_KEYS.has('anthropicApiKey'), true)

// ── Editability ───────────────────────────────────────────────────────────
// theme had a default but was absent from the old EDITABLE_KEYS.
check('theme is agent-editable', D.AGENT_EDITABLE_KEYS.includes('theme'), true)
check('voiceId is agent-editable', D.AGENT_EDITABLE_KEYS.includes('voiceId'), true)

// ── Coercion ──────────────────────────────────────────────────────────────
check('voice name coerces to id', D.coerceSettingValue('voiceId', 'zenya'), {
  ok: true,
  value: 'f5iYMGdlB5CJwK2vhzsS',
})
check('voice id passes through', D.coerceSettingValue('voiceId', 'EST9Ui6982FZPSi7gCHi'), {
  ok: true,
  value: 'EST9Ui6982FZPSi7gCHi',
})
check('unknown voice rejected', D.coerceSettingValue('voiceId', 'nope').ok, false)
check('rejected voice lists options', /Zenya/.test(D.coerceSettingValue('voiceId', 'nope').error), true)

check('enum accepts member', D.coerceSettingValue('personalityMode', 'unbridled'), { ok: true, value: 'unbridled' })
check('enum rejects non-member', D.coerceSettingValue('personalityMode', 'chaotic').ok, false)
check('enum error lists legal values', /standard/.test(D.coerceSettingValue('personalityMode', 'chaotic').error), true)
check('theme accepts display name', D.coerceSettingValue('theme', 'Frutiger Aero'), { ok: true, value: 'aero' })
check('theme accepts id', D.coerceSettingValue('theme', 'gothic'), { ok: true, value: 'gothic' })
check('orb style accepts id', D.coerceSettingValue('voiceOrbStyle', 'helix'), { ok: true, value: 'helix' })
check('numeric enum key accepted', D.coerceSettingValue('japaneseLevel', 2), { ok: true, value: 2 })

check('toggle accepts bool', D.coerceSettingValue('showFurigana', false), { ok: true, value: false })
check('toggle rejects string', D.coerceSettingValue('showFurigana', 'yes').ok, false)

check('number clamps low', D.coerceSettingValue('ttsStability', -1), { ok: true, value: 0 })
check('number clamps high', D.coerceSettingValue('ttsStability', 5), { ok: true, value: 1 })
check('number accepts in-range', D.coerceSettingValue('ttsStability', 0.4), { ok: true, value: 0.4 })
check('number rejects NaN', D.coerceSettingValue('ttsStability', 'abc').ok, false)

check('secret refused via coercion', D.coerceSettingValue('anthropicApiKey', 'sk-x').ok, false)
check('unknown key refused', D.coerceSettingValue('nonsenseKey', 1).ok, false)

// ── describeSettings ──────────────────────────────────────────────────────
// A setting never written must still be reported, at its default. This is the
// gap that left Shingan blind to anything the user had not explicitly changed.
const summary = describeSettings({})
check('reports unset key at its default', /Furigana:\s+on/.test(summary), true)
check(
  'reports every described key',
  Object.keys(D.SETTING_DESCRIPTORS).every((k) => summary.includes(D.SETTING_DESCRIPTORS[k].label)),
  true
)
check('marks a default as such', summary.includes('[default]'), true)

const withSecret = describeSettings({ anthropicApiKey: 'sk-super-secret', tavilyApiKey: 'enc:v1:blob' })
check('secret shown as set', /Anthropic API key:\s+\(set\)/.test(withSecret), true)
check('secret value never echoed', withSecret.includes('sk-super-secret'), false)
check('encrypted blob never echoed', withSecret.includes('enc:v1:blob'), false)

const named = describeSettings({ voiceId: 'f5iYMGdlB5CJwK2vhzsS', theme: 'aero', voiceOrbStyle: 'helix' })
check('voice id renders as name', named.includes('Zenya'), true)
check('theme id renders as name', named.includes('Frutiger Aero'), true)
check('orb id renders as name', named.includes('Helix'), true)

// An unusable stored value must be called out, not shown as if it were fine.
check('unknown voice flagged', describeSettings({ voiceId: 'zenya' }).includes('UNKNOWN'), true)

fs.rmSync(OUT, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
