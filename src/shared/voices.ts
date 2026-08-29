/**
 * The voice catalogue, plus the validation both write paths need.
 *
 * This list used to live inside `VoiceSettings.tsx`, so the main process —
 * where settings are actually persisted — had never seen it and could not tell
 * a real ElevenLabs id from arbitrary text. That gap is not theoretical: a
 * `voiceId` of `zenya` was found saved in the local database, and every TTS
 * call made with it came back
 *
 *   404 voice_not_found — A voice with voice_id 'zenya' was not found.
 *
 * which silently disabled speech for every reply. The agent's `update_setting`
 * tool takes a free-form string, so the model wrote the name it knew rather
 * than the opaque id it had no way to look up.
 *
 * Keeping the table in `shared/` lets the renderer's dropdown and the main
 * process validate against exactly the same rows, so a voice added here shows
 * up in both without a second edit.
 *
 * Every id below was probed against the ElevenLabs API on 2026-08-29 using this
 * app's own key and the parameters `textToSpeech.ts` sends
 * (`eleven_turbo_v2_5`, `pcm_22050`). All of them returned HTTP 200 with
 * non-empty audio. Adam and George are `premade`, Zenya is `cloned`, and the
 * rest are `professional` — the professional ones are not gated on this
 * account, so category alone is not a reason to drop a voice.
 */

export interface VoiceOption {
  /** ElevenLabs voice id — the only thing the API accepts. */
  value: string
  /** What the dropdown shows, and what the user is most likely to say. */
  label: string
}

export const VOICE_CATALOGUE: VoiceOption[] = [
  { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam (US)' },
  { value: 'JBFqnCBsd6RMkjVDRZzb', label: 'George (UK)' },
  { value: 'f5iYMGdlB5CJwK2vhzsS', label: 'Zenya' },
  { value: '6fZce9LFNG3iEITDfqZZ', label: 'Charlotte' },
  { value: 'aEO01A4wXwd1O8GPgGlF', label: 'Arabella (AU)' },
  { value: 'QeRkfdkzgy4CefJ3AcII', label: 'Sky (UK)' },
  { value: 'EST9Ui6982FZPSi7gCHi', label: 'Elise' },
  { value: 'wIzYfKZE8c87XZD7bDLH', label: 'Zibby' },
  { value: 'ut2XM2wJyIZLTtW6lFzZ', label: 'Eliza' },
]

/** The id used when a stored value turns out to be unusable. Adam, premade. */
export const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'

/** True when `id` is a voice this build offers. */
export function isValidVoiceId(id: unknown): id is string {
  return typeof id === 'string' && VOICE_CATALOGUE.some((v) => v.value === id)
}

/**
 * Casefolds and strips anything that is not a letter or digit, so "Arabella
 * (AU)", "arabella", and "ARABELLA" all collapse to the same key.
 *
 * The parenthetical is dropped first: it is a disambiguating accent tag rather
 * than part of the name, and nobody says "switch to Arabella paren AU".
 */
export function normalizeVoiceName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Resolves whatever a caller supplied to a real voice id, or `null` if it
 * matches nothing.
 *
 * Accepts an id unchanged, and also accepts a voice *name* — that is the case
 * that actually bit us, and rejecting it outright would leave the agent unable
 * to honour "switch to Zenya" at all. Coercing beats failing here because the
 * user's intent is unambiguous once the name matches exactly one row.
 */
export function resolveVoiceId(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (isValidVoiceId(trimmed)) return trimmed

  const key = normalizeVoiceName(trimmed)
  if (!key) return null
  const match = VOICE_CATALOGUE.find((v) => normalizeVoiceName(v.label) === key)
  return match ? match.value : null
}
