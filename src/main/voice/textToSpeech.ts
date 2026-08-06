import { ElevenLabsClient } from 'elevenlabs'

// Hard ceiling on a single TTS call. A runaway/hallucinating LLM response
// fed wholesale into ElevenLabs is the other half of the "possessed rambling"
// failure mode — this failsafe truncates it instead of speaking all of it.
const MAX_TTS_CHARS = 2000

export class TextToSpeech {
  private client: ElevenLabsClient
  private voiceId: string
  private stability = 0.7
  private similarityBoost = 0.75

  constructor(apiKey: string, voiceId?: string) {
    this.client = new ElevenLabsClient({ apiKey })
    // Default voice — user can change in settings among the 8 options there.
    // "Adam" is a deep, calm male voice that fits the Shingan archetype.
    this.voiceId = voiceId || 'pNInz6obpgDQGcFmaJgB'
  }

  /**
   * Stream TTS for real-time playback.
   * Yields raw PCM audio chunks as they arrive from ElevenLabs.
   *
   * `languageCode` locks the model to a single language instead of letting
   * it guess per-segment, which is what caused mid-sentence language
   * switches and mispronunciation on bilingual text.
   */
  async *speakStream(text: string, languageCode: 'ja' | 'en' = 'en'): AsyncGenerator<Buffer> {
    const clipped = text.length > MAX_TTS_CHARS ? text.slice(0, MAX_TTS_CHARS) : text

    const audioStream = await this.client.textToSpeech.convertAsStream(this.voiceId, {
      text: clipped,
      model_id: 'eleven_turbo_v2_5', // Slightly slower than flash, notably more consistent
      output_format: 'pcm_22050', // Raw PCM for Web Audio playback
      language_code: languageCode, // Only Turbo/Flash v2.5 support enforcing this — locks output to one language
      apply_language_text_normalization: languageCode === 'ja', // Improves Japanese pronunciation; costs latency so only on for JA
      voice_settings: {
        stability: this.stability,
        similarity_boost: this.similarityBoost,
        style: 0, // Exaggeration adds take-to-take variance; keep it off for a steady voice
      },
    })

    for await (const chunk of audioStream) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    }
  }

  setVoice(voiceId: string): void {
    this.voiceId = voiceId
  }

  setVoiceSettings(stability: number, similarityBoost: number): void {
    this.stability = stability
    this.similarityBoost = similarityBoost
  }
}
