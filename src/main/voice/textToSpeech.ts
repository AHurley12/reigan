import { ElevenLabsClient } from 'elevenlabs'

export class TextToSpeech {
  private client: ElevenLabsClient
  private voiceId: string
  private stability = 0.5
  private similarityBoost = 0.75

  constructor(apiKey: string, voiceId?: string) {
    this.client = new ElevenLabsClient({ apiKey })
    // Default voice — user can change in settings. "Adam" is a deep, calm
    // male voice that fits the Shingan archetype. Others: Antoni, Josh, Sam.
    this.voiceId = voiceId || 'pNInz6obpgDQGcFmaJgB'
  }

  /**
   * Stream TTS for real-time playback.
   * Yields raw PCM audio chunks as they arrive from ElevenLabs.
   */
  async *speakStream(text: string): AsyncGenerator<Buffer> {
    const audioStream = await this.client.textToSpeech.convertAsStream(this.voiceId, {
      text,
      model_id: 'eleven_flash_v2_5', // Fastest model, still natural
      output_format: 'pcm_22050', // Raw PCM for Web Audio playback
      voice_settings: {
        stability: this.stability,
        similarity_boost: this.similarityBoost,
        style: 0.3,
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
