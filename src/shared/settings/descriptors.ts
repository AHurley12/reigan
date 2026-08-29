import { DEFAULT_SETTINGS } from '../constants'
import { VOICE_CATALOGUE, resolveVoiceId, voiceLabelFor } from '../voices'
import { ORB_STYLE_LABELS } from '../orbStyles'
import { THEME_NAMES } from '../themeIds'

/**
 * The one place that knows a setting exists.
 *
 * Before this table there were four overlapping lists — `AppSettings`,
 * `DEFAULT_SETTINGS`, `EDITABLE_KEYS`/`SECRET_KEYS` in settingsTools, and
 * `SECRET_SETTING_KEYS` in db/secrets — and they had already drifted:
 * `tavilyApiKey` and `googleTokens` were encrypted at rest but absent from the
 * agent's mask, so they reached the model as `enc:v1:…` blobs; and `theme` had
 * a default the agent was never allowed to change. Everything derives from
 * here now, so drift becomes a compile error rather than a silent hole.
 */

export type SettingKind = 'toggle' | 'enum' | 'number' | 'text' | 'secret'

export interface SettingDescriptor {
  /** Human name, used in the summary the model reads. */
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
 * vestigial config from an older build (nothing under src/ reads it) and
 * `googleTokens` is the OAuth blob, refresh token included. Both are listed so
 * the secret mask and the summary account for them instead of leaking blobs.
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
  showFurigana: {
    label: 'Furigana',
    kind: 'toggle',
    summary: 'Reading aids above kanji.',
    agentEditable: true,
  },
  showRomaji: {
    label: 'Romaji',
    kind: 'toggle',
    summary: 'Latin transliteration alongside kana.',
    agentEditable: true,
  },
  voiceResponseMode: {
    label: 'Voice replies',
    kind: 'enum',
    summary: 'When replies are spoken aloud.',
    options: { always: 'Always speak replies', conversational: 'Voice input only', off: 'Off' },
    agentEditable: true,
  },
  particleCount: {
    label: 'Particle count',
    kind: 'number',
    summary: 'Orb particle budget.',
    min: 0,
    max: 20000,
    agentEditable: true,
  },
  voiceId: {
    label: 'Voice',
    kind: 'enum',
    summary: 'Which ElevenLabs voice speaks replies.',
    options: Object.fromEntries(VOICE_CATALOGUE.map((v) => [v.value, v.label])),
    agentEditable: true,
  },
  pushToTalk: {
    label: 'Push-to-talk',
    kind: 'toggle',
    summary: 'On: hold the shortcut. Off: press to toggle.',
    agentEditable: true,
  },
  ttsStability: {
    label: 'TTS stability',
    kind: 'number',
    summary: 'Higher is steadier, lower is more expressive.',
    min: 0,
    max: 1,
    agentEditable: true,
  },
  ttsSimilarity: {
    label: 'TTS similarity',
    kind: 'number',
    summary: 'How closely output tracks the reference voice.',
    min: 0,
    max: 1,
    agentEditable: true,
  },
  showOrbColumn: {
    label: 'Orb column',
    kind: 'toggle',
    summary: 'Show the orb/avatar column.',
    agentEditable: true,
  },
  reducedMotion: {
    label: 'Reduced motion',
    kind: 'toggle',
    summary: 'Suppress animation.',
    agentEditable: true,
  },
  audioInputDeviceId: {
    label: 'Microphone',
    kind: 'text',
    summary: 'Input device id, or "default".',
    agentEditable: true,
  },
  audioOutputDeviceId: {
    label: 'Speaker',
    kind: 'text',
    summary: 'Output device id, or "default".',
    agentEditable: true,
  },
  personalityMode: {
    label: 'Personality mode',
    kind: 'enum',
    summary: 'Standard, or Unbridled with the filter off.',
    options: { standard: 'Standard', unbridled: 'Unbridled' },
    agentEditable: true,
  },
  unbridledModeAcknowledged: {
    label: 'Unbridled warning acknowledged',
    kind: 'toggle',
    summary: 'Whether the one-time warning was accepted.',
    agentEditable: false,
  },
  avatarModelChoice: {
    label: 'Avatar model',
    kind: 'text',
    summary: 'Selected avatar, or a custom model id.',
    agentEditable: true,
  },
  avatarCustomModelLabel: {
    label: 'Custom avatar label',
    kind: 'text',
    summary: 'Display name for a custom avatar.',
    agentEditable: true,
  },
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

/** Keys whose value must never reach the model or a log. Derived. */
export const SECRET_KEYS = new Set<string>(
  (Object.keys(SETTING_DESCRIPTORS) as SettingKey[]).filter((k) => SETTING_DESCRIPTORS[k].kind === 'secret')
)

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string }

/**
 * Validates and normalises a value for `key`.
 *
 * Coerces where the intent is unambiguous rather than only refusing: a voice
 * *name* becomes its id, a theme's display name becomes its id, and an
 * out-of-range number is clamped. Refusing those would leave the agent unable
 * to honour "switch to Zenya" at all — which is exactly how an unusable
 * `voiceId` of `zenya` came to be saved in the first place.
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
    // voiceId also accepts a spoken name; see resolveVoiceId.
    if (key === 'voiceId') {
      const resolved = resolveVoiceId(value)
      if (resolved) return { ok: true, value: resolved }
      return {
        ok: false,
        error: `"${String(value)}" is not a known voice. Available: ${Object.values(opts).join(', ')}.`,
      }
    }
    const asKey = String(value)
    // Numeric-keyed enums (japaneseLevel) must keep their number type, or the
    // renderer's `=== 2` comparisons stop matching.
    if (asKey in opts) return { ok: true, value: typeof value === 'number' ? value : asKey }
    // Accept the display name too, so "Frutiger Aero" resolves to `aero`.
    const byLabel = Object.entries(opts).find(([, label]) => label.toLowerCase() === asKey.toLowerCase())
    if (byLabel) return { ok: true, value: byLabel[0] }
    const legal = Object.entries(opts)
      .map(([k, label]) => `${k} (${label})`)
      .join(', ')
    return { ok: false, error: `${d.label} must be one of: ${legal}. Got ${JSON.stringify(value)}.` }
  }

  if (typeof value === 'string') return { ok: true, value }
  return { ok: false, error: `${d.label} needs a string, got ${JSON.stringify(value)}.` }
}

/** Display name for a stored value, for the settings summary. */
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
