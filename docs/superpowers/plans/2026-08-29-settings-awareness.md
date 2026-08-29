# Settings Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Shingan an accurate, complete picture of its own settings — every key, its active value, human-readable names instead of opaque ids — from one shared descriptor table that replaces the parallel key lists scattered across the codebase.

**Architecture:** A single `SETTING_DESCRIPTORS` table in `shared/` becomes the one place that knows a setting exists. It is typed `satisfies Record<SettingKey, SettingDescriptor>`, so omitting a key is a compile error. Everything else derives from it: the agent's editable-key allowlist, the secret mask, the write-time guards, and a `describeSettings()` renderer used by both `get_settings` and the system prompt. Enum option lists (voices, orb styles, themes) move to `shared/` as id+label pairs; the renderer's heavy registries keep their implementations and `satisfies` the shared lists, so the two cannot drift.

**Tech Stack:** TypeScript, Electron (main + renderer split), better-sqlite3, LangChain `DynamicStructuredTool` + zod, electron-vite.

**Spec:** This document (the request was given conversationally; requirements are restated under Global Constraints).

## Global Constraints

- **No new runtime dependencies.** The repo has no test runner and adding one is out of scope; verification is a committed `npm run check:settings` script that transpiles the shared modules with the existing `tsc` and runs plain-node assertions.
- **Shared code must not import from `src/renderer/` or `src/main/`.** `shared/` is imported by both; a renderer import in `shared/` breaks the main-process build.
- **Shared code must not import `electron`.** The check script runs shared modules under plain node.
- **No duplicated key lists.** After this plan, `EDITABLE_KEYS` and `SECRET_KEYS` in `settingsTools.ts` must not exist as literals; both derive from descriptors. `SECRET_SETTING_KEYS` in `db/secrets.ts` likewise.
- **Compile-time completeness.** Every descriptor table and every renderer registry that mirrors a shared list uses `satisfies` so a missing entry fails `tsc`, not runtime.
- **Preserve existing behaviour** for: encryption-at-rest key coverage (never shrink it), `googleTokens` round-tripping as a JSON object, and the `{ success: boolean }` IPC result shape.
- Verify with `npx tsc --noEmit -p tsconfig.node.json`, `... -p tsconfig.web.json`, `npm run check:settings`, and `npm run build`.

---

## Background: what is actually broken

Established by reading the code, not assumed:

1. `getAllSettings()` (`src/main/db/queries.ts`) returns only rows present in the `settings` table. A setting never written has no row, so it is **absent** from `get_settings` output. Shingan cannot see any setting still at its default.
2. `getAllSettings()` returns **raw** values, so encrypted rows reach the agent as `enc:v1:…` blobs.
3. `SECRET_KEYS` in `settingsTools.ts` lists 5 keys. `SECRET_SETTING_KEYS` in `db/secrets.ts` lists 6 — a different set. `tavilyApiKey` and `googleTokens` are encrypted at rest but **absent from the agent's mask**, so they render as blobs (and as plaintext on any machine where `safeStorage` is unavailable and the value was stored unencrypted).
4. `voiceId` renders as `f5iYMGdlB5CJwK2vhzsS`. Nothing maps an id back to "Zenya".
5. Nothing tells the model which values are legal. `update_setting`'s schema is `z.union([z.string(), z.number(), z.boolean()])` for every key.
6. `theme` is in `AppSettings` and `DEFAULT_SETTINGS` but missing from `EDITABLE_KEYS`, so the agent silently cannot change it.
7. `tavilyApiKey` is persisted and encrypted but read by no code in `src/` — it is vestigial config from an older build.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/orbStyles.ts` (create) | Orb style ids + labels. No DOM. |
| `src/shared/themeIds.ts` (create) | Theme ids + display names. No React. |
| `src/shared/voices.ts` (modify) | Add `voiceLabelFor()`. Catalogue already here. |
| `src/shared/settings/descriptors.ts` (create) | The one table describing every persisted setting. |
| `src/shared/settings/describe.ts` (create) | `describeSettings()` — renders full state for humans/LLM. |
| `src/main/db/queries.ts` (modify) | Guards derive from descriptors; add `getAllDecodedSettings()`. |
| `src/main/db/secrets.ts` (modify) | `SECRET_SETTING_KEYS` derives from descriptors. |
| `src/main/agents/tools/settingsTools.ts` (modify) | Both key lists deleted; tools use descriptors + `describeSettings()`. |
| `src/main/agents/reigan.ts` (modify) | Inject live settings block into the system prompt. |
| `src/main/ipc/system.ts` (modify) | `resetExecutor()` on any setting change, not just the API key. |
| `src/renderer/.../orbRegistry.ts` (modify) | `satisfies Record<OrbStyleId, OrbStyleDef>`. |
| `src/renderer/src/theme/registry.ts` (modify) | `satisfies Record<ThemeId, Theme>`. |
| `scripts/check-settings.cjs` (create) | Node assertions over the shared modules. |
| `package.json` (modify) | `check:settings` script. |

---

### Task 1: Shared enum option lists

Moves the id+label halves of the orb and theme registries into `shared/` so the main process can name them, without moving DOM or React code.

**Files:**
- Create: `src/shared/orbStyles.ts`, `src/shared/themeIds.ts`
- Modify: `src/shared/voices.ts`, `src/renderer/src/components/Orb/engine/orbRegistry.ts`, `src/renderer/src/theme/registry.ts`

**Interfaces:**
- Produces: `ORB_STYLE_LABELS: Record<OrbStyleId, string>`, `type OrbStyleId`, `THEME_NAMES: Record<ThemeId, string>`, `type ThemeId`, `voiceLabelFor(id: string): string | null`

- [ ] **Step 1: Create `src/shared/orbStyles.ts`**

```ts
/**
 * Orb style ids and their display names.
 *
 * The implementations live in the renderer (`orbRegistry.ts`) because each one
 * constructs DOM. Only the id → label half lives here, so the main process can
 * name the active orb without importing renderer code. `orbRegistry.ts`
 * `satisfies Record<OrbStyleId, OrbStyleDef>`, so adding a style there without
 * adding it here fails to compile.
 */
export const ORB_STYLE_LABELS = {
  nebula: 'Rose Nebula',
  cube: 'Cube',
  sphere: 'Sphere',
  helix: 'Helix',
  ai_orb: 'AI Orb',
} as const

export type OrbStyleId = keyof typeof ORB_STYLE_LABELS

export const DEFAULT_ORB_STYLE: OrbStyleId = 'nebula'

export function isOrbStyleId(v: unknown): v is OrbStyleId {
  return typeof v === 'string' && v in ORB_STYLE_LABELS
}
```

- [ ] **Step 2: Create `src/shared/themeIds.ts`**

```ts
/**
 * Theme ids and their display names. The full themes — tokens, lazy-loaded
 * Effects components, watermarks — stay in `renderer/theme/registry.ts`, which
 * `satisfies Record<ThemeId, Theme>` against this list.
 */
export const THEME_NAMES = {
  shingan: 'Shingan',
  gothic: 'Sepulchral',
  aero: 'Frutiger Aero',
} as const

export type ThemeId = keyof typeof THEME_NAMES

export const DEFAULT_THEME_ID: ThemeId = 'shingan'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && v in THEME_NAMES
}
```

- [ ] **Step 3: Add `voiceLabelFor` to `src/shared/voices.ts`**

Append:

```ts
/** The display name for a voice id, or null when the id is not in the catalogue. */
export function voiceLabelFor(id: unknown): string | null {
  if (typeof id !== 'string') return null
  const match = VOICE_CATALOGUE.find((v) => v.value === id)
  return match ? match.label : null
}
```

- [ ] **Step 4: Constrain the renderer registries**

In `src/renderer/src/components/Orb/engine/orbRegistry.ts`, import the shared ids and change the declaration so the two lists cannot drift. Replace `export const ORB_STYLES: Record<string, OrbStyleDef> = {` with:

```ts
import type { OrbStyleId } from '../../../../../shared/orbStyles'
export { DEFAULT_ORB_STYLE } from '../../../../../shared/orbStyles'

export const ORB_STYLES = {
```

and close the object with `} satisfies Record<OrbStyleId, OrbStyleDef>`. Delete the file's own `export const DEFAULT_ORB_STYLE = 'nebula'` line — it is now re-exported from shared.

In `src/renderer/src/theme/registry.ts`, change `} satisfies Record<string, Theme>` to `} satisfies Record<ThemeId, Theme>` and import `ThemeId` from `../../../shared/themeIds`. Delete the local `export type ThemeId = keyof typeof THEMES` and `isThemeId`, re-exporting both from shared instead:

```ts
export { type ThemeId, isThemeId, DEFAULT_THEME_ID } from '../../../shared/themeIds'
```

- [ ] **Step 5: Verify both projects still typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: no output. If a registry entry is missing from the shared list, `satisfies` reports it here — that is the guard working.

- [ ] **Step 6: Commit**

```bash
git add src/shared/orbStyles.ts src/shared/themeIds.ts src/shared/voices.ts src/renderer/src/components/Orb/engine/orbRegistry.ts src/renderer/src/theme/registry.ts
git commit -m "refactor(settings): lift orb and theme id lists into shared"
```

---

### Task 2: The descriptor table

**Files:**
- Create: `src/shared/settings/descriptors.ts`
- Test: `scripts/check-settings.cjs` (created here, extended in Task 3)
- Modify: `package.json`

**Interfaces:**
- Consumes: `ORB_STYLE_LABELS`, `THEME_NAMES`, `VOICE_CATALOGUE`, `resolveVoiceId` (Task 1)
- Produces: `SETTING_DESCRIPTORS`, `type SettingKey`, `type SettingDescriptor`, `AGENT_EDITABLE_KEYS: SettingKey[]`, `SECRET_KEYS: Set<string>`, `descriptorFor(key)`, `coerceSettingValue(key, value)`

- [ ] **Step 1: Write the failing check**

Create `scripts/check-settings.cjs`:

```js
/**
 * Assertions over the shared settings modules. No test runner in this repo, so
 * this transpiles the shared tree with the project's own tsc and asserts
 * against plain node. Run via `npm run check:settings`.
 */
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const ROOT = path.join(__dirname, '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'check-settings')
fs.rmSync(OUT, { recursive: true, force: true })

execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', 'src/shared/settings/describe.ts', '--module', 'commonjs', '--target', 'es2020',
   '--esModuleInterop', '--skipLibCheck', '--rootDir', 'src', '--outDir', OUT],
  { cwd: ROOT, stdio: 'inherit' }
)

const D = require(path.join(OUT, 'shared/settings/descriptors.js'))
const { describeSettings } = require(path.join(OUT, 'shared/settings/describe.js'))
const { DEFAULT_SETTINGS } = require(path.join(OUT, 'shared/constants.js'))

let pass = 0, fail = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  ok ? pass++ : fail++
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `\n  got:      ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`))
}

// Every key with a default must be described.
const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => !D.SETTING_DESCRIPTORS[k])
check('every default has a descriptor', missing, [])

// Secrets are never agent-editable.
const leaky = D.AGENT_EDITABLE_KEYS.filter((k) => D.SECRET_KEYS.has(k))
check('no secret is agent-editable', leaky, [])

// The two keys the old mask missed.
check('tavilyApiKey masked', D.SECRET_KEYS.has('tavilyApiKey'), true)
check('googleTokens masked', D.SECRET_KEYS.has('googleTokens'), true)

// theme was missing from the old EDITABLE_KEYS.
check('theme is agent-editable', D.AGENT_EDITABLE_KEYS.includes('theme'), true)

// Enum coercion.
check('voice name coerces', D.coerceSettingValue('voiceId', 'zenya'), { ok: true, value: 'f5iYMGdlB5CJwK2vhzsS' })
check('bad voice rejected', D.coerceSettingValue('voiceId', 'nope').ok, false)
check('enum accepts member', D.coerceSettingValue('personalityMode', 'unbridled'), { ok: true, value: 'unbridled' })
check('enum rejects non-member', D.coerceSettingValue('personalityMode', 'chaotic').ok, false)
check('toggle accepts bool', D.coerceSettingValue('showFurigana', false), { ok: true, value: false })
check('toggle rejects string', D.coerceSettingValue('showFurigana', 'yes').ok, false)
check('number clamps low', D.coerceSettingValue('ttsStability', -1), { ok: true, value: 0 })
check('number clamps high', D.coerceSettingValue('ttsStability', 5), { ok: true, value: 1 })
check('number rejects NaN', D.coerceSettingValue('ttsStability', 'abc').ok, false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
```

Add to `package.json` scripts: `"check:settings": "node scripts/check-settings.cjs"`

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run check:settings`
Expected: FAIL — tsc errors, `src/shared/settings/descriptors.ts` does not exist.

- [ ] **Step 3: Write `src/shared/settings/descriptors.ts`**

```ts
import { DEFAULT_SETTINGS } from '../constants'
import { VOICE_CATALOGUE, resolveVoiceId, voiceLabelFor } from '../voices'
import { ORB_STYLE_LABELS } from '../orbStyles'
import { THEME_NAMES } from '../themeIds'

/**
 * The one place that knows a setting exists.
 *
 * Before this table there were four overlapping lists — `AppSettings`,
 * `DEFAULT_SETTINGS`, `EDITABLE_KEYS` and `SECRET_KEYS` in settingsTools, and
 * `SECRET_SETTING_KEYS` in db/secrets — and they had already drifted:
 * `tavilyApiKey` and `googleTokens` were encrypted at rest but absent from the
 * agent's mask, and `theme` had a default the agent was not allowed to change.
 * Everything now derives from here, so drift is a compile error rather than a
 * silent hole.
 */

export type SettingKind = 'toggle' | 'enum' | 'number' | 'text' | 'secret'

export interface SettingDescriptor {
  /** Human name, used in the settings summary the model reads. */
  label: string
  kind: SettingKind
  /** One line on what it does. Shown to the model; keep it short. */
  summary: string
  /** Legal values for `kind: 'enum'`, as id → display name. */
  options?: Record<string, string>
  /** Inclusive bounds for `kind: 'number'`. Values outside are clamped. */
  min?: number
  max?: number
  /** Whether the agent's update_setting tool may write this key. */
  agentEditable: boolean
}

/**
 * Persisted keys that are not part of `AppSettings`: `tavilyApiKey` is
 * vestigial config from an older build (nothing in src/ reads it) and
 * `googleTokens` is the OAuth blob. Both are listed so the secret mask and the
 * settings summary account for them instead of leaking blobs.
 */
export type ExtraSettingKey = 'tavilyApiKey' | 'googleTokens'
export type SettingKey = keyof typeof DEFAULT_SETTINGS | ExtraSettingKey

const secret = (label: string, summary: string): SettingDescriptor => ({
  label,
  kind: 'secret',
  summary,
  agentEditable: false,
})

export const SETTING_DESCRIPTORS = {
  anthropicApiKey: secret('Anthropic API key', 'Powers the assistant itself.'),
  deepgramApiKey: secret('Deepgram API key', 'Speech-to-text for voice input.'),
  elevenLabsApiKey: secret('ElevenLabs API key', 'Text-to-speech for spoken replies.'),
  googleClientId: secret('Google client ID', 'OAuth client for Gmail and Calendar.'),
  googleClientSecret: secret('Google client secret', 'OAuth secret for Gmail and Calendar.'),
  tavilyApiKey: secret('Tavily API key', 'Legacy web-search key; nothing reads it any more.'),
  googleTokens: secret('Google OAuth tokens', 'Stored Gmail/Calendar session, including the refresh token.'),

  japaneseLevel: {
    label: 'Japanese level',
    kind: 'enum',
    summary: 'How much Japanese to weave into replies.',
    options: { 0: 'Off', 1: 'Ambient', 2: 'Learning' },
    agentEditable: true,
  },
  showFurigana: { label: 'Furigana', kind: 'toggle', summary: 'Reading aids above kanji.', agentEditable: true },
  showRomaji: { label: 'Romaji', kind: 'toggle', summary: 'Latin transliteration alongside kana.', agentEditable: true },
  voiceResponseMode: {
    label: 'Voice replies',
    kind: 'enum',
    summary: 'When replies are spoken aloud.',
    options: { always: 'Always speak replies', conversational: 'Voice input only', off: 'Off' },
    agentEditable: true,
  },
  particleCount: { label: 'Particle count', kind: 'number', summary: 'Orb particle budget.', min: 0, max: 20000, agentEditable: true },
  voiceId: {
    label: 'Voice',
    kind: 'enum',
    summary: 'Which ElevenLabs voice speaks replies.',
    options: Object.fromEntries(VOICE_CATALOGUE.map((v) => [v.value, v.label])),
    agentEditable: true,
  },
  pushToTalk: { label: 'Push-to-talk', kind: 'toggle', summary: 'On: hold the shortcut. Off: press to toggle.', agentEditable: true },
  ttsStability: { label: 'TTS stability', kind: 'number', summary: 'Higher is steadier, lower is more expressive.', min: 0, max: 1, agentEditable: true },
  ttsSimilarity: { label: 'TTS similarity', kind: 'number', summary: 'How closely output tracks the reference voice.', min: 0, max: 1, agentEditable: true },
  showOrbColumn: { label: 'Orb column', kind: 'toggle', summary: 'Show the orb/avatar column.', agentEditable: true },
  reducedMotion: { label: 'Reduced motion', kind: 'toggle', summary: 'Suppress animation.', agentEditable: true },
  audioInputDeviceId: { label: 'Microphone', kind: 'text', summary: 'Input device id, or "default".', agentEditable: true },
  audioOutputDeviceId: { label: 'Speaker', kind: 'text', summary: 'Output device id, or "default".', agentEditable: true },
  personalityMode: {
    label: 'Personality mode',
    kind: 'enum',
    summary: 'Standard, or Unbridled with the filter off.',
    options: { standard: 'Standard', unbridled: 'Unbridled' },
    agentEditable: true,
  },
  unbridledModeAcknowledged: { label: 'Unbridled warning acknowledged', kind: 'toggle', summary: 'Whether the one-time warning was accepted.', agentEditable: false },
  avatarModelChoice: { label: 'Avatar model', kind: 'text', summary: 'Selected avatar, or a custom model id.', agentEditable: true },
  avatarCustomModelLabel: { label: 'Custom avatar label', kind: 'text', summary: 'Display name for a custom avatar.', agentEditable: true },
  voiceOrbStyle: {
    label: 'Orb style',
    kind: 'enum',
    summary: 'Which orb visualisation is drawn.',
    options: ORB_STYLE_LABELS,
    agentEditable: true,
  },
  theme: {
    label: 'Theme',
    kind: 'enum',
    summary: 'Active skin.',
    options: THEME_NAMES,
    agentEditable: true,
  },
} satisfies Record<SettingKey, SettingDescriptor>

export function descriptorFor(key: string): SettingDescriptor | null {
  return (SETTING_DESCRIPTORS as Record<string, SettingDescriptor>)[key] ?? null
}

/** Keys the agent may write. Derived, never hand-listed. */
export const AGENT_EDITABLE_KEYS = (Object.keys(SETTING_DESCRIPTORS) as SettingKey[]).filter(
  (k) => SETTING_DESCRIPTORS[k].agentEditable
)

/** Keys whose value must never reach the model or the log. Derived. */
export const SECRET_KEYS = new Set(
  (Object.keys(SETTING_DESCRIPTORS) as SettingKey[]).filter((k) => SETTING_DESCRIPTORS[k].kind === 'secret')
)

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * Validates and normalises a value for `key`.
 *
 * Coerces where intent is unambiguous rather than only refusing: a voice
 * *name* becomes its id, and an out-of-range number is clamped. Refusing those
 * would leave the agent unable to honour "switch to Zenya" or "set stability
 * to 2" at all.
 */
export function coerceSettingValue(key: string, value: unknown): CoerceResult {
  const d = descriptorFor(key)
  if (!d) return { ok: false, error: `"${key}" is not a known setting.` }

  if (d.kind === 'secret') {
    return { ok: false, error: `${d.label} is a credential and can only be set in the Settings UI.` }
  }

  if (d.kind === 'toggle') {
    if (typeof value === 'boolean') return { ok: true, value }
    return { ok: false, error: `${d.label} is on/off — pass true or false, not ${JSON.stringify(value)}.` }
  }

  if (d.kind === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) return { ok: false, error: `${d.label} needs a number, got ${JSON.stringify(value)}.` }
    const lo = d.min ?? -Infinity
    const hi = d.max ?? Infinity
    return { ok: true, value: Math.min(hi, Math.max(lo, n)) }
  }

  if (d.kind === 'enum') {
    const opts = d.options ?? {}
    // voiceId accepts a spoken name as well as an id; see resolveVoiceId.
    if (key === 'voiceId') {
      const resolved = resolveVoiceId(value)
      if (resolved) return { ok: true, value: resolved }
      return { ok: false, error: `"${String(value)}" is not a known voice. Available: ${Object.values(opts).join(', ')}.` }
    }
    const asKey = String(value)
    if (asKey in opts) return { ok: true, value: typeof value === 'number' ? value : asKey }
    // Accept the display name too, so "Frutiger Aero" resolves to `aero`.
    const byLabel = Object.entries(opts).find(([, label]) => label.toLowerCase() === asKey.toLowerCase())
    if (byLabel) return { ok: true, value: byLabel[0] }
    const legal = Object.entries(opts).map(([k, label]) => `${k} (${label})`).join(', ')
    return { ok: false, error: `${d.label} must be one of: ${legal}. Got ${JSON.stringify(value)}.` }
  }

  if (typeof value === 'string') return { ok: true, value }
  return { ok: false, error: `${d.label} needs a string, got ${JSON.stringify(value)}.` }
}

/** Display name for a value, for the settings summary. */
export function displayValue(key: string, value: unknown): string {
  const d = descriptorFor(key)
  if (!d) return JSON.stringify(value)
  if (d.kind === 'secret') return value ? '(set)' : '(not set)'
  if (d.kind === 'toggle') return value ? 'on' : 'off'
  if (d.kind === 'enum') {
    if (key === 'voiceId') {
      const label = voiceLabelFor(value)
      return label ? `${label} (${String(value)})` : `${String(value)} — UNKNOWN, not in the catalogue`
    }
    const label = d.options?.[String(value)]
    return label ? `${label} (${String(value)})` : `${String(value)} — UNKNOWN`
  }
  return String(value)
}
```

- [ ] **Step 4: Run the check**

Run: `npm run check:settings`
Expected: all assertions PASS. `coerceSettingValue` cases and the descriptor-completeness case must all be green.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings/descriptors.ts scripts/check-settings.cjs package.json
git commit -m "feat(settings): single descriptor table for every persisted setting"
```

---

### Task 3: `describeSettings()` — the full active picture

The fix for "Shingan can't see settings still at their default": merge `DEFAULT_SETTINGS` with stored rows so every key is reported.

**Files:**
- Create: `src/shared/settings/describe.ts`
- Modify: `scripts/check-settings.cjs`

**Interfaces:**
- Consumes: `SETTING_DESCRIPTORS`, `displayValue`, `SECRET_KEYS`, `DEFAULT_SETTINGS`
- Produces: `describeSettings(stored: Record<string, unknown>): string`

- [ ] **Step 1: Add the failing assertions to `scripts/check-settings.cjs`**

Insert before the summary lines:

```js
// A setting never written must still be reported, at its default.
const summary = describeSettings({})
check('reports unset key at default', /Furigana:\s+on/.test(summary), true)
check('reports every described key', Object.keys(D.SETTING_DESCRIPTORS).every((k) => summary.includes(D.SETTING_DESCRIPTORS[k].label)), true)

// Secrets are masked, never echoed.
const withSecret = describeSettings({ anthropicApiKey: 'sk-super-secret', tavilyApiKey: 'enc:v1:blob' })
check('secret masked as set', /Anthropic API key:\s+\(set\)/.test(withSecret), true)
check('secret value never echoed', withSecret.includes('sk-super-secret'), false)
check('encrypted blob never echoed', withSecret.includes('enc:v1:blob'), false)

// Ids render with their names.
const named = describeSettings({ voiceId: 'f5iYMGdlB5CJwK2vhzsS', theme: 'aero' })
check('voice id renders as name', named.includes('Zenya'), true)
check('theme id renders as name', named.includes('Frutiger Aero'), true)

// An unusable stored value is called out rather than shown as if fine.
check('unknown voice flagged', describeSettings({ voiceId: 'zenya' }).includes('UNKNOWN'), true)
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm run check:settings`
Expected: FAIL — `src/shared/settings/describe.ts` does not exist.

- [ ] **Step 3: Write `src/shared/settings/describe.ts`**

```ts
import { DEFAULT_SETTINGS } from '../constants'
import { SETTING_DESCRIPTORS, displayValue, type SettingKey } from './descriptors'

/**
 * Renders the complete active settings state as a compact block.
 *
 * Merges over `DEFAULT_SETTINGS` deliberately: `getAllSettings()` returns only
 * rows that exist, so anything still at its default had no row and was simply
 * absent from what the model saw. A setting the model cannot see is one it
 * will happily contradict.
 *
 * Secrets are reduced to (set)/(not set) here rather than at the call site, so
 * no caller can forget. Values are never echoed.
 */
export function describeSettings(stored: Record<string, unknown>): string {
  const keys = Object.keys(SETTING_DESCRIPTORS) as SettingKey[]
  const lines = keys.map((key) => {
    const d = SETTING_DESCRIPTORS[key]
    const has = Object.prototype.hasOwnProperty.call(stored, key)
    const raw = has ? stored[key] : (DEFAULT_SETTINGS as Record<string, unknown>)[key]
    const shown = displayValue(key, raw)
    const origin = has || d.kind === 'secret' ? '' : ' [default]'
    return `- ${d.label}: ${shown}${origin} — ${d.summary}`
  })
  return lines.join('\n')
}
```

- [ ] **Step 4: Run the check**

Run: `npm run check:settings`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/settings/describe.ts scripts/check-settings.cjs
git commit -m "feat(settings): describeSettings reports defaults and masks secrets"
```

---

### Task 4: Wire the agent tools and delete the duplicate lists

**Files:**
- Modify: `src/main/agents/tools/settingsTools.ts`, `src/main/db/queries.ts`, `src/main/db/secrets.ts`

**Interfaces:**
- Consumes: `AGENT_EDITABLE_KEYS`, `SECRET_KEYS`, `coerceSettingValue`, `descriptorFor`, `describeSettings`
- Produces: `getAllDecodedSettings(): Record<string, unknown>`

- [ ] **Step 1: Add `getAllDecodedSettings` to `src/main/db/queries.ts`**

```ts
/**
 * Every stored setting, JSON-decoded, with secrets reduced to a boolean
 * "is it set". `getAllSettings()` returns raw column text, so encrypted rows
 * come back as `enc:v1:…` blobs — fine for the renderer, wrong for anything
 * that renders a summary.
 */
export function getAllDecodedSettings(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(getAllSettings())) {
    if (SECRET_KEYS.has(key)) {
      out[key] = raw !== '' && raw != null
      continue
    }
    try {
      out[key] = JSON.parse(raw)
    } catch {
      out[key] = raw
    }
  }
  return out
}
```

Import `SECRET_KEYS` from `../../shared/settings/descriptors`.

- [ ] **Step 2: Derive the write guard from descriptors**

In `queries.ts`, replace the `SETTING_GUARDS` object and the guard block inside `setSetting` with a descriptor-driven version, so every enum/number/toggle is validated rather than only `voiceId`:

```ts
export function setSetting(key: string, value: string): void {
  if (descriptorFor(key)) {
    let decoded: unknown = value
    try {
      decoded = JSON.parse(value)
    } catch {
      // Legacy unquoted row; validate the raw string as-is.
    }
    const result = coerceSettingValue(key, decoded)
    if (!result.ok) throw new InvalidSettingError(key, result.error)
    value = JSON.stringify(result.value)
  }
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}
```

Import `descriptorFor` and `coerceSettingValue`. Delete the now-unused `resolveVoiceId` import and the whole `SETTING_GUARDS` block.

**Caution:** `coerceSettingValue` refuses `kind: 'secret'`, but the Settings UI legitimately writes API keys through this path. Exempt secrets from the guard by changing the condition to `const d = descriptorFor(key); if (d && d.kind !== 'secret') {`. Verify by saving an API key in the running app before committing.

- [ ] **Step 3: Derive `SECRET_SETTING_KEYS` in `src/main/db/secrets.ts`**

Replace the hand-written `Set` with:

```ts
import { SECRET_KEYS } from '../../shared/settings/descriptors'

/**
 * Setting keys treated as credentials, derived from the descriptor table so
 * this list and the agent's mask cannot drift apart — they already had:
 * `tavilyApiKey` and `googleTokens` were encrypted here but visible there.
 *
 * `googleClientId` is deliberately NOT secret for encryption purposes — it is
 * transmitted in the consent URL — but it is masked from the agent. Encrypting
 * it is harmless, so the single list is used for both.
 */
export const SECRET_SETTING_KEYS = SECRET_KEYS
```

- [ ] **Step 4: Rewrite `settingsTools.ts` with no local key lists**

```ts
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getAllDecodedSettings, setSetting, getDecodedSetting, InvalidSettingError } from '../../db/queries'
import { describeSettings } from '../../../shared/settings/describe'
import { AGENT_EDITABLE_KEYS, descriptorFor } from '../../../shared/settings/descriptors'
import { withPermission } from './permission'

export const getSettingsTool = new DynamicStructuredTool({
  name: 'get_settings',
  description:
    "Read the user's current app settings — every setting, including ones still at their default. " +
    'Credentials are reported only as set/not set, never their value.',
  schema: z.object({}),
  func: async () => describeSettings(getAllDecodedSettings()),
})

// Built from the descriptor table so the model is told the legal values up
// front instead of discovering them by failing.
const EDITABLE_SUMMARY = AGENT_EDITABLE_KEYS.map((k) => {
  const d = descriptorFor(k)!
  const legal =
    d.kind === 'enum'
      ? Object.entries(d.options ?? {}).map(([id, label]) => `${id} (${label})`).join(', ')
      : d.kind === 'toggle'
        ? 'true or false'
        : d.kind === 'number'
          ? `number ${d.min ?? '-inf'}..${d.max ?? 'inf'}`
          : 'text'
  return `${k} — ${d.label}: ${legal}`
}).join('\n')

export const updateSettingTool = new DynamicStructuredTool({
  name: 'update_setting',
  description:
    'Change one app setting. Credentials cannot be touched — those are set in the Settings UI.\n' +
    'A voice or theme may be named rather than given by id ("Zenya", "Frutiger Aero").\n\n' +
    EDITABLE_SUMMARY,
  schema: z.object({
    key: z.enum(AGENT_EDITABLE_KEYS as [string, ...string[]]).describe('The setting to change'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('The new value'),
  }),
  func: async ({ key, value }) =>
    withPermission('update_setting', `Change setting "${key}" to ${JSON.stringify(value)}`, () => {
      try {
        setSetting(key, JSON.stringify(value))
      } catch (err) {
        if (err instanceof InvalidSettingError) return `Could not update ${key}: ${err.message}`
        throw err
      }
      // Read back: a guard may have normalised the value (a voice name is
      // stored as its id), so echoing the input would misreport what was saved.
      return `Updated ${key} to ${JSON.stringify(getDecodedSetting(key))}.`
    }),
})
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit -p tsconfig.node.json && npm run check:settings`
Expected: no tsc output; all checks PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/agents/tools/settingsTools.ts src/main/db/queries.ts src/main/db/secrets.ts
git commit -m "refactor(settings): derive agent key lists and guards from descriptors"
```

---

### Task 5: Make the live settings part of the system prompt

A tool the model must remember to call is weaker than state it always has. This appends the summary to the system prompt and keeps it fresh.

**Files:**
- Modify: `src/main/agents/reigan.ts`, `src/main/ipc/system.ts`

- [ ] **Step 1: Append the settings block when building the executor**

In `reigan.ts`, replace `const systemPrompt = mode === 'unbridled' ? ... : ...` with:

```ts
const basePrompt = mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT
// ChatPromptTemplate parses f-string placeholders, so any brace in a stored
// value (a custom avatar label, say) would be read as a template variable and
// throw. Escape before interpolating.
const settingsBlock = describeSettings(getAllDecodedSettings()).replace(/\{/g, '{{').replace(/\}/g, '}}')
const systemPrompt = `${basePrompt}

## Your current settings

These are live values, not examples. Use them instead of asking the user what
their settings are, and do not claim a setting is off when it is listed as on.
Change one with update_setting.

${settingsBlock}`
```

Import `describeSettings` from `../../shared/settings/describe` and `getAllDecodedSettings` from `../db/queries`.

- [ ] **Step 2: Keep it fresh on every settings change**

The executor is cached, so a settings change would otherwise leave a stale block in the prompt. In `src/main/ipc/system.ts`, change the post-write line from `if (key === 'anthropicApiKey') resetExecutor()` to:

```ts
    // The system prompt embeds the live settings block, so any change makes the
    // cached executor stale — not just an API-key change.
    resetExecutor()
```

- [ ] **Step 3: Verify the prompt builds and braces are safe**

Run: `npx tsc --noEmit -p tsconfig.node.json && npm run build`
Then launch the app, set a custom avatar label containing `{braces}`, and send a message.
Expected: the reply arrives normally. A template-parsing regression shows up here as an error mentioning a missing input variable.

- [ ] **Step 4: Confirm the behaviour end to end**

Launch the app and ask: "which voice are you using, and is furigana on?"
Expected: it names the voice ("Zenya"), not an id, and reports furigana without calling a tool.
Then: "switch to Zibby" → confirms, and Settings → Voice shows Zibby.

- [ ] **Step 5: Commit**

```bash
git add src/main/agents/reigan.ts src/main/ipc/system.ts
git commit -m "feat(agent): put live settings in the system prompt"
```

---

## Self-Review

**Spec coverage.** Name→id both ways: Task 1 (`voiceLabelFor`) + Task 2 (`displayValue`). "Aware of all settings and active toggles": Task 3 (defaults merged) + Task 5 (always in prompt). "Without redundancy": Task 4 deletes `EDITABLE_KEYS`, `SECRET_KEYS`, `SETTING_GUARDS`, and the hand-written `SECRET_SETTING_KEYS`; Task 1 collapses the orb/theme id lists via `satisfies`. Error messages listing legal values: Task 2 `coerceSettingValue`.

**Type consistency.** `SettingKey`, `SettingDescriptor`, `CoerceResult`, `coerceSettingValue`, `descriptorFor`, `displayValue`, `describeSettings`, `getAllDecodedSettings`, `AGENT_EDITABLE_KEYS`, `SECRET_KEYS` are each defined once and referenced with the same names throughout.

**Known risks.**
- Task 4 Step 2 is the sharp edge: routing every write through `coerceSettingValue` will reject API-key saves unless secrets are exempted. The step says so explicitly; do not skip its verification.
- `resetExecutor()` on every settings write (Task 5) rebuilds the LangChain chain more often. It only reconstructs a prompt and tool list — no network — but if it proves costly, gate it on the key actually appearing in `SETTING_DESCRIPTORS`.
- `theme` becomes agent-editable for the first time. That is the intent (it had a default but no way to change it), but it means the model can now restyle the app.
