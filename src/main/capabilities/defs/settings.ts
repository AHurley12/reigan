import { z } from 'zod'
import { getSetting, setSetting } from '../../db/queries'
import { DEFAULT_SETTINGS } from '../../../shared/constants'
import {
  AGENT_EDITABLE_SETTINGS,
  AGENT_LOCKED_SETTINGS,
  describeSettingValue,
  findEditableSetting,
  validateSettingValue,
  type EditableSetting,
} from '../../../shared/settingsCatalog'
import { VOICE_CATALOGUE, resolveVoice, voiceLabel, type VoiceOption } from '../../../shared/voices'
import { broadcastSettingChange } from '../../settings/broadcast'
import { listElevenLabsVoices } from '../../voice/voiceLibrary'
import { CapabilityError, type AnyCapability, type CapabilityDiff } from '../types'

/**
 * Shingan changing its own settings, and its own voice.
 *
 * Replaces the hand-written `agents/tools/settingsTools.ts`, which
 * `agents/reigan.ts` itself flagged as legacy ("New tools must be added as
 * capabilities, not here"). Moving it here is not tidying for its own sake —
 * three things the user asked for only work on this side of the line:
 *
 *  - The approval card gets a real before/after `diff`. The old tool passed a
 *    summary string containing raw JSON, so "change setting theme to sakura"
 *    was the whole of what the user was asked to approve, with no indication of
 *    what it was changing *from*.
 *  - Values are validated against each setting's actual shape. The old schema
 *    was `z.union([string, number, boolean])` for every key alike, so
 *    `japaneseLevel: 'high'` was written to the database unchallenged.
 *  - The locked list is enforced in one place and is testable, rather than
 *    being an array a future credential can be forgotten from.
 */

/** Reads a stored setting, JSON-decoding it, falling back to the shipped default. */
function readSetting(key: string): unknown {
  const raw = getSetting(key)
  if (raw === null) return (DEFAULT_SETTINGS as Record<string, unknown>)[key]
  try {
    return JSON.parse(raw)
  } catch {
    // Rows written before values were JSON-encoded are bare strings.
    return raw
  }
}

/** Writes a setting the way the renderer does, then tells the UI it moved. */
function writeSetting(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value))
  broadcastSettingChange(key, value)
}

/**
 * Resolves the setting the model named, refusing locked keys with the reason
 * rather than a bare "unknown setting" — the model relays that reason to the
 * user, and "I can't change your API keys from chat" is a far better answer
 * than "that setting does not exist".
 */
function requireEditable(key: string): EditableSetting {
  const locked = AGENT_LOCKED_SETTINGS[key]
  if (locked) throw new CapabilityError(locked, 'denied')

  const setting = findEditableSetting(key)
  if (!setting) {
    const known = AGENT_EDITABLE_SETTINGS.map((s) => s.key).join(', ')
    throw new CapabilityError(`There is no changeable setting called "${key}". Available: ${known}.`, 'invalid_args')
  }
  return setting
}

/**
 * The voice setting's options are the voice catalogue, which lives in
 * `shared/voices.ts`. Resolved here rather than duplicated into the settings
 * catalogue, so adding a voice stays a one-line change.
 */
function voiceSetting(): EditableSetting {
  return {
    ...findEditableSetting('voiceId')!,
    options: VOICE_CATALOGUE.map((v) => ({ value: v.value, label: v.label })),
  }
}

function settingFor(key: string): EditableSetting {
  const setting = requireEditable(key)
  return setting.key === 'voiceId' ? voiceSetting() : setting
}

/**
 * The same lookup, but never throwing — for the approval spec.
 *
 * `registry.ts` guards `spec.diff()` but calls `spec.summary()` unguarded, so a
 * summary that throws escapes `invokeCapability` entirely and takes the agent
 * turn down with it. A refusal must read as "I can't change your API keys",
 * not as a crashed reply, so the card describes what was *asked for* and the
 * handler raises the real error a moment later.
 */
function maybeSettingFor(key: string): EditableSetting | null {
  try {
    return settingFor(key)
  } catch {
    return null
  }
}

function diffFor(setting: EditableSetting, next: unknown): CapabilityDiff {
  return {
    subject: setting.label,
    changes: [
      {
        field: setting.label,
        before: describeSettingValue(setting, readSetting(setting.key)),
        after: describeSettingValue(setting, next),
      },
    ],
  }
}

// ── settings.list ───────────────────────────────────────────────────────────

const listSchema = z.object({})

// ── settings.set ────────────────────────────────────────────────────────────

const setSchema = z.object({
  key: z
    .string()
    .describe('The setting to change. Call settings.list first if you are unsure of the exact key.'),
  value: z
    .union([z.string(), z.number(), z.boolean()])
    .describe('The new value. Must match the setting’s type and allowed values.'),
})
type SetArgs = z.infer<typeof setSchema>

// ── settings.toggle ─────────────────────────────────────────────────────────

const toggleSchema = z.object({
  key: z.string().describe('The on/off setting to change.'),
  value: z
    .boolean()
    .optional()
    .describe('Leave this out to flip the current value. Pass true or false to set it explicitly.'),
})
type ToggleArgs = z.infer<typeof toggleSchema>

// ── voice.set ───────────────────────────────────────────────────────────────

const voiceSetSchema = z.object({
  voice: z
    .string()
    .describe('The voice to switch to, by name — for example "Zenya" or "Arabella". An id also works.'),
})
type VoiceSetArgs = z.infer<typeof voiceSetSchema>

const voiceListSchema = z.object({})

/**
 * The catalogue plus, when a key is configured, whatever else the account
 * holds. Failure to reach ElevenLabs degrades to the built-in list rather than
 * erroring: the seven curated voices are the ones the user is most likely to
 * name, and losing the network should not make "switch to Zenya" stop working.
 */
async function fullCatalogue(): Promise<{ voices: VoiceOption[]; live: boolean }> {
  const remote = await listElevenLabsVoices()
  if (!remote) return { voices: VOICE_CATALOGUE, live: false }

  const merged = [...VOICE_CATALOGUE]
  const seen = new Set(merged.map((v) => v.value))
  for (const voice of remote) {
    if (!seen.has(voice.value)) {
      merged.push(voice)
      seen.add(voice.value)
    }
  }
  return { voices: merged, live: true }
}

/** Shared by voice.set's summary, diff and handler, so all three agree. */
async function resolveRequestedVoice(query: string): Promise<VoiceOption> {
  const { voices } = await fullCatalogue()
  const result = resolveVoice(query, voices)

  if (result.status === 'ok') return result.voice

  if (result.status === 'ambiguous') {
    const names = result.matches.map((v) => v.label).join(', ')
    throw new CapabilityError(
      `"${query}" matches more than one voice: ${names}. Ask which one they meant.`,
      'invalid_args'
    )
  }

  const names = voices.map((v) => v.label).join(', ')
  throw new CapabilityError(`There is no voice called "${query}". Available voices: ${names}.`, 'invalid_args')
}

export const settingsCapabilities: AnyCapability[] = [
  {
    id: 'settings.list',
    title: 'Read settings',
    description:
      'List the app settings you are allowed to change, with their current values and allowed ' +
      'values. Call this before changing something you are unsure about. Also reports the settings ' +
      'that are deliberately off-limits, and why, so you can explain a refusal accurately. API keys ' +
      'are never included.',
    risk: 'read',
    schema: listSchema,
    handler: () => {
      const editable = AGENT_EDITABLE_SETTINGS.map((base) => {
        const setting = base.key === 'voiceId' ? voiceSetting() : base
        return {
          key: setting.key,
          label: setting.label,
          kind: setting.kind,
          description: setting.description,
          current: describeSettingValue(setting, readSetting(setting.key)),
          allowed:
            setting.kind === 'enum'
              ? (setting.options ?? []).map((o) => String(o.value))
              : setting.kind === 'boolean'
                ? ['true', 'false']
                : [`${setting.min ?? '-∞'} to ${setting.max ?? '∞'}`],
        }
      })

      return { editable, locked: AGENT_LOCKED_SETTINGS }
    },
    formatResult: (result: { editable: any[]; locked: Record<string, string> }) => {
      const lines = result.editable.map(
        (s) => `${s.key} (${s.label}) — currently ${s.current}. Allowed: ${s.allowed.join(', ')}.`
      )
      const locked = Object.entries(result.locked).map(([key, reason]) => `${key} — ${reason}`)
      return [
        'Settings you can change:',
        ...lines,
        '',
        'Settings you cannot change:',
        ...locked,
      ].join('\n')
    },
  },

  {
    id: 'settings.set',
    title: 'Change a setting',
    description:
      'Change one app setting — theme, voice options, Japanese level, motion, model, and so on. ' +
      'Use settings.toggle for a simple on/off, and voice.set to change which voice speaks. ' +
      'The user approves each change before it takes effect.',
    risk: 'write',
    schema: setSchema,
    approval: {
      summary: (a: SetArgs) => {
        const setting = maybeSettingFor(a.key)
        if (!setting) return `Change ${a.key} to ${JSON.stringify(a.value)}.`
        const validated = validateSettingValue(setting, a.value)
        const after = validated.ok ? describeSettingValue(setting, validated.value) : String(a.value)
        return `Change ${setting.label} to ${after}.`
      },
      diff: (a: SetArgs) => {
        const setting = maybeSettingFor(a.key)
        if (!setting) return null
        const validated = validateSettingValue(setting, a.value)
        return validated.ok ? diffFor(setting, validated.value) : null
      },
    },
    handler: (args: SetArgs) => {
      const setting = settingFor(args.key)
      const validated = validateSettingValue(setting, args.value)
      if (!validated.ok) throw new CapabilityError(validated.error, 'invalid_args')

      const before = describeSettingValue(setting, readSetting(setting.key))
      writeSetting(setting.key, validated.value)
      const after = describeSettingValue(setting, validated.value)

      return `${setting.label} is now ${after} (was ${before}).`
    },
  },

  {
    id: 'settings.toggle',
    title: 'Turn a setting on or off',
    description:
      'Turn an on/off setting on or off — furigana, romaji, push-to-talk, extended thinking, the ' +
      'orb column. Leave the value out to flip whatever it is currently set to. The user approves ' +
      'the change before it takes effect.',
    risk: 'write',
    schema: toggleSchema,
    approval: {
      summary: (a: ToggleArgs) => {
        const setting = maybeSettingFor(a.key)
        if (!setting) return `Turn ${a.key} ${a.value === false ? 'off' : 'on'}.`
        const next = a.value ?? !readSetting(setting.key)
        return `Turn ${setting.label} ${next ? 'on' : 'off'}.`
      },
      diff: (a: ToggleArgs) => {
        const setting = maybeSettingFor(a.key)
        if (!setting) return null
        const next = a.value ?? !readSetting(setting.key)
        return diffFor(setting, next)
      },
    },
    handler: (args: ToggleArgs) => {
      const setting = settingFor(args.key)
      if (setting.kind !== 'boolean') {
        throw new CapabilityError(
          `${setting.label} is not an on/off setting — use settings.set to give it a value.`,
          'invalid_args'
        )
      }

      const current = readSetting(setting.key)
      // An explicit value wins; otherwise flip. `!current` rather than
      // `current === false` so a missing or malformed row still turns *on*,
      // which is what "toggle it" means to someone looking at a control that
      // appears off.
      const next = args.value ?? !current
      writeSetting(setting.key, next)

      return `${setting.label} is now ${next ? 'on' : 'off'}.`
    },
  },

  {
    id: 'voice.list',
    title: 'List voices',
    description:
      'List the voices Shingan can speak with, by name. Includes the built-in selection and, when ' +
      'an ElevenLabs key is configured, every voice on the account. Call this if the user asks ' +
      'what voices are available, or names one you do not recognise.',
    risk: 'network',
    schema: voiceListSchema,
    handler: async () => {
      const { voices, live } = await fullCatalogue()
      const current = String(readSetting('voiceId') ?? '')
      return {
        current: voiceLabel(current, voices),
        live,
        voices: voices.map((v) => v.label),
      }
    },
    formatResult: (r: { current: string; live: boolean; voices: string[] }) =>
      `Currently speaking as ${r.current}.\nAvailable voices: ${r.voices.join(', ')}.` +
      (r.live ? '' : '\n(Built-in list only — no ElevenLabs key configured, or the service was unreachable.)'),
  },

  {
    id: 'voice.set',
    title: 'Change voice',
    description:
      'Switch the voice Shingan speaks with. Accepts a name such as "Zenya" or "Arabella" — you do ' +
      'not need the id. If the name is ambiguous or unknown you are told which voices exist, so ask ' +
      'the user rather than guessing. The user approves the change before it takes effect.',
    risk: 'write',
    schema: voiceSetSchema,
    approval: {
      summary: (a: VoiceSetArgs) => `Switch the speaking voice to ${a.voice}.`,
      diff: async (a: VoiceSetArgs): Promise<CapabilityDiff | null> => {
        // A name that does not resolve produces no diff; the handler raises the
        // real error. Throwing here would be swallowed by the registry's
        // "a diff is an aid, not a precondition" catch and lose the message.
        try {
          const voice = await resolveRequestedVoice(a.voice)
          const { voices } = await fullCatalogue()
          return {
            subject: 'Voice',
            changes: [
              {
                field: 'Voice',
                before: voiceLabel(String(readSetting('voiceId') ?? ''), voices),
                after: voice.label,
              },
            ],
          }
        } catch {
          return null
        }
      },
    },
    handler: async (args: VoiceSetArgs) => {
      const voice = await resolveRequestedVoice(args.voice)
      const { voices } = await fullCatalogue()
      const before = voiceLabel(String(readSetting('voiceId') ?? ''), voices)

      writeSetting('voiceId', voice.value)

      return `Now speaking as ${voice.label} (was ${before}).`
    },
  },
]
