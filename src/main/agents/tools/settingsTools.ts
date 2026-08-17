import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getAllSettings, setSetting } from '../../db/queries'
import { withPermission } from './permission'

// Credentials never flow through chat — an agent that can read or overwrite
// its own API keys is a prompt-injection risk, and rotating them belongs in
// the Settings UI where the user is looking directly at what they're typing.
const SECRET_KEYS = new Set(['anthropicApiKey', 'deepgramApiKey', 'elevenLabsApiKey', 'googleClientId', 'googleClientSecret'])

// Every non-secret key in AppSettings (shared/types.ts) — kept as an explicit
// allowlist rather than "everything except SECRET_KEYS" so a future secret
// field isn't exposed by default just because someone forgot to list it here.
const EDITABLE_KEYS = [
  'japaneseLevel', 'showFurigana', 'showRomaji', 'voiceResponseMode', 'particleCount',
  'voiceId', 'pushToTalk', 'ttsStability', 'ttsSimilarity', 'showOrbColumn', 'motion',
  'audioInputDeviceId', 'audioOutputDeviceId', 'personalityMode', 'unbridledModeAcknowledged',
  'avatarModelChoice', 'avatarCustomModelLabel', 'voiceOrbStyle',
] as const

function decode(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export const getSettingsTool = new DynamicStructuredTool({
  name: 'get_settings',
  description:
    "Read the user's current app settings (Japanese level, voice options, personality mode, UI preferences, etc). API keys are never exposed here — only whether one is set.",
  schema: z.object({}),
  func: async () => {
    const all = getAllSettings()
    const lines = Object.entries(all).map(([key, raw]) => {
      if (SECRET_KEYS.has(key)) return `${key}: ${raw ? '(set)' : '(not set)'}`
      return `${key}: ${JSON.stringify(decode(raw))}`
    })
    return lines.length ? lines.join('\n') : 'No settings saved yet — defaults are in effect.'
  },
})

export const updateSettingTool = new DynamicStructuredTool({
  name: 'update_setting',
  description:
    'Change one app setting (e.g. personalityMode, voiceResponseMode, japaneseLevel, ttsStability). Cannot touch API keys/credentials — those must be set in the Settings UI directly.',
  schema: z.object({
    key: z.enum(EDITABLE_KEYS).describe('The setting to change'),
    value: z.union([z.string(), z.number(), z.boolean()]).describe('The new value'),
  }),
  func: async ({ key, value }) =>
    withPermission('update_setting', `Change setting "${key}" to ${JSON.stringify(value)}`, () => {
      setSetting(key, JSON.stringify(value))
      return `Updated ${key} to ${JSON.stringify(value)}.`
    }),
})
