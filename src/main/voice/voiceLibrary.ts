import { ElevenLabsClient } from 'elevenlabs'
import { getDecodedSetting } from '../db/queries'
import type { VoiceOption } from '../../shared/voices'

/**
 * The voices on the user's own ElevenLabs account.
 *
 * The curated list in `shared/voices.ts` covers the seven voices in the
 * Settings dropdown, which is enough for "switch to Zenya" but not for a voice
 * the user cloned or added to their library last week — they would name it, and
 * be told it does not exist. This fetches the real list so the name they use is
 * the name that resolves.
 *
 * Every failure path returns `null` rather than throwing. A missing key, an
 * expired key, a rate limit or a dead network all mean the same thing to the
 * caller — "no live list this time" — and none of them should turn a voice
 * switch into an error when the built-in list would have answered it.
 */

/** Cached briefly: a research turn can call voice.list and voice.set back to back. */
const CACHE_TTL_MS = 5 * 60 * 1000

let cache: { at: number; voices: VoiceOption[] } | null = null

export function clearVoiceLibraryCache(): void {
  cache = null
}

export async function listElevenLabsVoices(): Promise<VoiceOption[] | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.voices

  const apiKey = getDecodedSetting('elevenLabsApiKey')
  if (!apiKey) return null

  try {
    const client = new ElevenLabsClient({ apiKey })
    const response = await client.voices.getAll()

    const voices = (response.voices ?? [])
      // A voice with no name cannot be asked for by name, and an entry with no
      // id cannot be selected — neither is useful to us.
      .filter((v) => v.voice_id && v.name)
      .map<VoiceOption>((v) => ({ value: v.voice_id, label: v.name as string }))

    cache = { at: Date.now(), voices }
    return voices
  } catch {
    return null
  }
}
