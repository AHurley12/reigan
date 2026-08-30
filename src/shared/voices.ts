/**
 * The voice catalogue, and the name → id resolution the assistant needs.
 *
 * This list used to live inside `VoiceSettings.tsx`, which meant the main
 * process — where the agent runs — had never seen it. Asking Shingan to
 * "switch to Zenya" could not work even in principle: the only thing the model
 * could pass to a settings tool was the raw ElevenLabs id
 * (`f5iYMGdlB5CJwK2vhzsS`), which it has no way to know. Names are the unit the
 * user speaks in, so the mapping has to exist somewhere both sides can read.
 *
 * Kept in `shared/` rather than duplicated: the renderer's dropdown and the
 * agent's `voice.set` capability now resolve against exactly the same table, so
 * a voice added here appears in both without a second edit.
 */

export interface VoiceOption {
  /** ElevenLabs voice id. */
  value: string
  /** What the dropdown shows, and what the user is most likely to say. */
  label: string
  /**
   * Extra spellings that should resolve to this voice. Only for cases the
   * generic normaliser cannot reach — an accent suffix is stripped
   * automatically, so `Arabella (AU)` needs no alias for "arabella".
   */
  aliases?: string[]
}

/**
 * Two premade defaults that work on any ElevenLabs plan, plus free-tier voices
 * from the user's library. `voice.list` can extend this at runtime with
 * whatever else their account holds; this stays the offline/keyless floor.
 *
 * Every id here was probed against the ElevenLabs API on 2026-08-29 with this
 * app's own key and the parameters textToSpeech.ts sends (eleven_turbo_v2_5,
 * pcm_22050): all returned HTTP 200 with non-empty audio. Adam and George are
 * `premade`, Zenya is `cloned`, the rest are `professional` — and the
 * professional ones are not gated on this account, so category alone is not a
 * reason to drop a voice from this list.
 */
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

/**
 * Casefolds and strips anything that is not a letter or digit, so "Arabella
 * (AU)", "arabella", and "ARABELLA" all collapse to the same key.
 *
 * The parenthetical is dropped first. It is a disambiguating accent tag rather
 * than part of the name, and nobody says "switch to Arabella paren AU".
 */
export function normalizeVoiceName(name: string): string {
  return name
    .replace(/\([^)]*\)/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export type VoiceResolution =
  | { status: 'ok'; voice: VoiceOption }
  /**
   * Several voices answer to the name. Returned rather than silently picking
   * the first, because switching to the wrong voice is invisible until it
   * speaks — the model should ask which one instead of guessing.
   */
  | { status: 'ambiguous'; matches: VoiceOption[] }
  | { status: 'none'; matches: VoiceOption[] }

/**
 * Resolves whatever the user called a voice to a catalogue entry.
 *
 * Tried in order of how certain the match is: an exact id, then an exact
 * (normalised) name, then a prefix, then a substring. Stopping at the first
 * tier that produces exactly one hit means "sky" does not become ambiguous
 * merely because some other voice happens to contain those letters.
 */
export function resolveVoice(query: string, catalogue: VoiceOption[] = VOICE_CATALOGUE): VoiceResolution {
  const raw = query.trim()
  if (!raw) return { status: 'none', matches: [] }

  const byId = catalogue.find((v) => v.value === raw)
  if (byId) return { status: 'ok', voice: byId }

  const needle = normalizeVoiceName(raw)
  if (!needle) return { status: 'none', matches: [] }

  const keys = (v: VoiceOption): string[] => [
    normalizeVoiceName(v.label),
    ...(v.aliases ?? []).map(normalizeVoiceName),
  ]

  const tiers = [
    catalogue.filter((v) => keys(v).some((k) => k === needle)),
    catalogue.filter((v) => keys(v).some((k) => k.startsWith(needle))),
    catalogue.filter((v) => keys(v).some((k) => k.includes(needle))),
  ]

  for (const tier of tiers) {
    if (tier.length === 1) return { status: 'ok', voice: tier[0] }
    if (tier.length > 1) return { status: 'ambiguous', matches: tier }
  }

  return { status: 'none', matches: [] }
}

/** The label for an id, falling back to the bare id for a voice not in the list. */
export function voiceLabel(voiceId: string, catalogue: VoiceOption[] = VOICE_CATALOGUE): string {
  return catalogue.find((v) => v.value === voiceId)?.label ?? voiceId
}
