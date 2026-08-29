/**
 * Which settings the assistant may change about itself, and what counts as a
 * valid value for each.
 *
 * The old `agents/tools/settingsTools.ts` carried a bare `EDITABLE_KEYS` array
 * and a `z.union([string, number, boolean])` value. That let the model set
 * `japaneseLevel: 'high'` or `ttsStability: 47` — accepted, written, and only
 * discovered when some renderer read it back and behaved strangely. A key alone
 * is not enough to validate against, so each entry carries its shape.
 *
 * Lives in `shared/` because both the capability (main) and any UI that wants
 * to explain what the assistant can touch (renderer) need the same answer.
 */

import { MODELS, MIN_THINKING_BUDGET, MIN_TEMPERATURE, MAX_TEMPERATURE } from './models'

export type EditableSettingKind = 'boolean' | 'enum' | 'number'

export interface EditableSetting {
  key: string
  /** Human label, used in the approval card and in `settings.list`. */
  label: string
  kind: EditableSettingKind
  /** Written for the model — it picks the key from these descriptions. */
  description: string
  /** enum only. */
  options?: Array<{ value: string | number; label: string }>
  /** number only. */
  min?: number
  max?: number
  /** number only: whole numbers rejected below this granularity. */
  integer?: boolean
}

/**
 * Settings the assistant must never write, each with the reason.
 *
 * Reasons are kept next to the keys rather than in a comment because this is
 * the list a reviewer checks when asking "can the model turn its own safety
 * off", and an unexplained entry is indistinguishable from an oversight — the
 * same argument the capability registry makes for `uiOnlyReason`.
 */
export const AGENT_LOCKED_SETTINGS: Record<string, string> = {
  // Credentials. An agent that can read or rewrite its own keys turns any
  // prompt injection into key exfiltration or a silent swap to an attacker's
  // endpoint. Rotating these belongs in Settings, where the user is looking
  // straight at what they are typing.
  anthropicApiKey: 'API keys are changed in Settings, never through chat.',
  tavilyApiKey: 'API keys are changed in Settings, never through chat.',
  deepgramApiKey: 'API keys are changed in Settings, never through chat.',
  elevenLabsApiKey: 'API keys are changed in Settings, never through chat.',
  googleClientId: 'Google credentials are changed in Settings, never through chat.',
  googleClientSecret: 'Google credentials are changed in Settings, never through chat.',
  googleTokens: 'OAuth tokens are managed by the Google connection flow.',

  // The approval gate itself. Everything else on this list is protected *by*
  // the approval card; this one would disable the card. A single approved
  // "turn off approval prompts" would remove the user's say over every future
  // action, which is precisely the decision that must not be delegatable to
  // the thing being gated.
  requireApprovalForAllCapabilities:
    'This is the switch that makes approval prompts appear at all. Only the user may change it, in Settings.',

  // Personality. `unbridled` relaxes how the assistant talks; letting the
  // assistant grant that to itself makes the acknowledgement meaningless —
  // the point of the flag is that the *user* opted in.
  personalityMode: 'Personality mode is the user’s choice to make, in Settings.',
  unbridledModeAcknowledged: 'This records the user’s own acknowledgement and cannot be self-granted.',

  // Device ids are enumerated by the browser in the renderer and are opaque
  // strings. The agent cannot see the list, so anything it supplied would be
  // a guess that silently routes audio nowhere.
  audioInputDeviceId: 'Audio devices are picked from the live device list in Settings.',
  audioOutputDeviceId: 'Audio devices are picked from the live device list in Settings.',

  // Paired with a model file the user uploads; a label without its bytes is
  // meaningless.
  avatarCustomModelLabel: 'This is set when the user uploads a custom avatar model.',
}

export const AGENT_EDITABLE_SETTINGS: EditableSetting[] = [
  {
    key: 'voiceId',
    label: 'Voice',
    kind: 'enum',
    description:
      'Which ElevenLabs voice speaks replies. Prefer the dedicated voice.set tool, which accepts a ' +
      'name like "Zenya" and knows the full voice list.',
    // Resolved at runtime from the voice catalogue — see settings.ts. Left
    // empty here to avoid a second copy of the voice list.
    options: [],
  },
  {
    key: 'voiceResponseMode',
    label: 'Speech responses',
    kind: 'enum',
    description:
      'When replies are spoken aloud. "always" speaks every reply, "conversational" speaks only ' +
      'when the user spoke first, "off" never speaks.',
    options: [
      { value: 'always', label: 'Always speak replies' },
      { value: 'conversational', label: 'Voice input only' },
      { value: 'off', label: 'Off' },
    ],
  },
  {
    key: 'voiceVolume',
    label: 'Voice volume',
    kind: 'number',
    description: 'Playback loudness for spoken replies, from 0 (silent) to 1 (full).',
    min: 0,
    max: 1,
  },
  {
    key: 'ttsStability',
    label: 'Voice stability',
    kind: 'number',
    description: 'How consistent the speaking voice is. Higher is steadier, lower is more expressive. 0 to 1.',
    min: 0,
    max: 1,
  },
  {
    key: 'ttsSimilarity',
    label: 'Voice similarity',
    kind: 'number',
    description: 'How closely speech matches the reference voice. 0 to 1.',
    min: 0,
    max: 1,
  },
  {
    key: 'pushToTalk',
    label: 'Push-to-talk',
    kind: 'boolean',
    description: 'On: hold the shortcut to talk. Off: the shortcut toggles listening on and off.',
  },
  {
    key: 'japaneseLevel',
    label: 'Japanese level',
    kind: 'enum',
    description: 'How much Japanese appears in the interface. 0 is off, 1 is ambient, 2 is learning mode.',
    options: [
      { value: 0, label: 'Off' },
      { value: 1, label: 'Ambient' },
      { value: 2, label: 'Learning' },
    ],
  },
  {
    key: 'showFurigana',
    label: 'Furigana',
    kind: 'boolean',
    description: 'Show furigana reading aids above Japanese text.',
  },
  {
    key: 'showRomaji',
    label: 'Romaji',
    kind: 'boolean',
    description: 'Show romaji transliteration alongside Japanese text.',
  },
  {
    key: 'theme',
    label: 'Theme',
    kind: 'enum',
    description: 'The visual skin of the whole app.',
    // Mirrors renderer/src/theme/registry.ts. Kept in step by a test rather
    // than by importing renderer code into main.
    options: [
      { value: 'shingan', label: 'Shingan' },
      { value: 'gothic', label: 'Gothic' },
      { value: 'aero', label: 'Frutiger Aero' },
      { value: 'sakura', label: 'Sakura' },
    ],
  },
  {
    key: 'voiceOrbStyle',
    label: 'Voice orb',
    kind: 'enum',
    description: 'The visual style of the orb shown while listening and speaking.',
    // Mirrors renderer/src/components/Orb/engine/orbRegistry.ts.
    options: [
      { value: 'nebula', label: 'Nebula' },
      { value: 'cube', label: 'Cube' },
      { value: 'sphere', label: 'Sphere' },
      { value: 'helix', label: 'Helix' },
      { value: 'ai_orb', label: 'AI Orb' },
    ],
  },
  {
    key: 'showOrbColumn',
    label: 'Orb column',
    kind: 'boolean',
    description: 'Show the orb and avatar column in the sidebar.',
  },
  {
    key: 'avatarModelChoice',
    label: 'Avatar model',
    kind: 'enum',
    description: 'Which avatar model is displayed. Custom uploads are chosen in Settings.',
    // Mirrors the presets in renderer/src/components/Orb/AvatarPanel.tsx.
    options: [
      { value: 'riruka', label: 'Riruka' },
      { value: 'anime-girl', label: 'Anime Girl' },
      { value: 'anime-girl-3d-model', label: 'anime+girl+3d+model' },
    ],
  },
  {
    key: 'motion',
    label: 'Motion',
    kind: 'enum',
    description:
      'How much animation is allowed. "system" follows the OS accessibility setting; the other two ' +
      'override it in either direction.',
    options: [
      { value: 'system', label: 'Follow the system' },
      { value: 'reduce', label: 'Reduce motion' },
      { value: 'full', label: 'Full motion' },
    ],
  },
  {
    key: 'particleCount',
    label: 'Particle count',
    kind: 'number',
    description: 'How many particles the orb renders. Lower is cheaper on the GPU.',
    min: 0,
    max: 50000,
    integer: true,
  },
  {
    key: 'model',
    label: 'Model',
    kind: 'enum',
    description: 'Which Claude model answers. Changing this affects cost and capability.',
    options: MODELS.map((m) => ({ value: m.id, label: m.label })),
  },
  {
    key: 'thinkingEnabled',
    label: 'Extended thinking',
    kind: 'boolean',
    description: 'Let the model reason at length before answering. Slower, and costs more tokens.',
  },
  {
    key: 'thinkingBudget',
    label: 'Thinking budget',
    kind: 'number',
    description: 'Maximum tokens the model may spend on extended thinking.',
    min: MIN_THINKING_BUDGET,
    max: 32000,
    integer: true,
  },
  {
    key: 'temperature',
    label: 'Temperature',
    kind: 'number',
    description:
      'Sampling temperature, 0 to 1. Lower is more deterministic. Cannot be combined with extended thinking.',
    min: MIN_TEMPERATURE,
    max: MAX_TEMPERATURE,
  },
]

const BY_KEY = new Map(AGENT_EDITABLE_SETTINGS.map((s) => [s.key, s]))

export function findEditableSetting(key: string): EditableSetting | undefined {
  return BY_KEY.get(key)
}

export type SettingValue = string | number | boolean

export type ValidationResult =
  | { ok: true; value: SettingValue }
  | { ok: false; error: string }

/**
 * Checks a proposed value against the setting's declared shape, and coerces the
 * few forms a language model reliably produces: `"true"` for a boolean, `"2"`
 * for a number, and an option's *label* where its value was wanted ("Sakura"
 * for `sakura`). Coercion is deliberately narrow — anything outside these forms
 * is an error the model should see and correct, not something to guess at.
 */
export function validateSettingValue(setting: EditableSetting, raw: unknown): ValidationResult {
  if (setting.kind === 'boolean') {
    if (typeof raw === 'boolean') return { ok: true, value: raw }
    if (raw === 'true') return { ok: true, value: true }
    if (raw === 'false') return { ok: true, value: false }
    return { ok: false, error: `${setting.label} is on/off — pass true or false, not ${JSON.stringify(raw)}.` }
  }

  if (setting.kind === 'number') {
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
    if (!Number.isFinite(num)) {
      return { ok: false, error: `${setting.label} takes a number, not ${JSON.stringify(raw)}.` }
    }
    if (setting.integer && !Number.isInteger(num)) {
      return { ok: false, error: `${setting.label} must be a whole number.` }
    }
    if (setting.min !== undefined && num < setting.min) {
      return { ok: false, error: `${setting.label} must be at least ${setting.min}.` }
    }
    if (setting.max !== undefined && num > setting.max) {
      return { ok: false, error: `${setting.label} must be at most ${setting.max}.` }
    }
    return { ok: true, value: num }
  }

  const options = setting.options ?? []
  if (options.length === 0) {
    // An enum whose options are filled in at runtime (voiceId). The caller
    // validates it; refusing here would block the legitimate path.
    return typeof raw === 'string'
      ? { ok: true, value: raw }
      : { ok: false, error: `${setting.label} takes a text value.` }
  }

  const exact = options.find((o) => o.value === raw)
  if (exact) return { ok: true, value: exact.value }

  if (typeof raw === 'string') {
    const fold = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const needle = fold(raw)
    const loose = options.find((o) => fold(String(o.value)) === needle || fold(o.label) === needle)
    if (loose) return { ok: true, value: loose.value }
  }

  // Numeric enums (japaneseLevel) arrive as "1" from a model often enough to
  // be worth handling rather than bouncing.
  if (typeof raw === 'string' && raw.trim() !== '') {
    const num = Number(raw)
    const numeric = options.find((o) => o.value === num)
    if (numeric) return { ok: true, value: numeric.value }
  }

  const allowed = options.map((o) => JSON.stringify(o.value)).join(', ')
  return { ok: false, error: `${setting.label} must be one of: ${allowed}.` }
}

/** How a value reads on the approval card and in listings. */
export function describeSettingValue(setting: EditableSetting, value: unknown): string {
  if (value === null || value === undefined) return 'default'
  const option = (setting.options ?? []).find((o) => o.value === value)
  if (option) return option.label
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  return String(value)
}
