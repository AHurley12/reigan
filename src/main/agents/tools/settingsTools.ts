import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { getAllSettings, setSetting } from '../../db/queries'
import { SECRET_SETTING_KEYS } from '../../db/secrets'
import { withPermission } from './permission'

// Credentials never flow through chat — an agent that can read or overwrite
// its own API keys is a prompt-injection risk, and rotating them belongs in
// the Settings UI where the user is looking directly at what they're typing.
//
// Derived from the storage layer's list rather than retyped. This was a
// hand-maintained copy, and it had already drifted: `googleTokens` was added to
// db/secrets.ts when credentials gained encryption at rest but never here, so
// `get_settings` read the blob back out, decrypted, and handed the model a live
// Google *refresh* token in plaintext — into the transcript and any log of it.
// Deriving means a future credential is masked the day it is declared one.
//
// `googleClientId` is added on top: db/secrets.ts deliberately excludes it
// because it travels in the consent URL and is not confidential, but the model
// still has no use for it, and it is the other half of the client credentials.
const SECRET_KEYS = new Set<string>([...SECRET_SETTING_KEYS, 'googleClientId'])

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
