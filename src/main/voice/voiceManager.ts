import { SpeechToText } from './speechToText'
import { TextToSpeech } from './textToSpeech'

export type VoiceState = 'idle' | 'listening' | 'speaking' | 'error'

interface VoiceManagerCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void
  onAudio: (audioBuffer: Buffer) => void
  onStateChange: (state: VoiceState) => void
  onError: (error: Error) => void
}

/**
 * Orchestrates Deepgram STT and ElevenLabs TTS. Owns a "voice turn" flag:
 * once a final transcript arrives, the next completed LLM response is
 * spoken automatically, then the manager returns to idle.
 */
export class VoiceManager {
  private stt: SpeechToText | null = null
  private tts: TextToSpeech | null = null
  private ttsVoiceId: string | undefined
  private isListening = false
  private expectSpokenReply = false
  private callbacks: VoiceManagerCallbacks | null = null

  setCallbacks(callbacks: VoiceManagerCallbacks): void {
    this.callbacks = callbacks
  }

  startListening(deepgramApiKey: string): void {
    if (!deepgramApiKey) {
      this.callbacks?.onError(new Error('No Deepgram API key configured. Add it in Settings.'))
      this.callbacks?.onStateChange('error')
      return
    }
    if (this.isListening) return

    this.stt = new SpeechToText(deepgramApiKey)
    this.isListening = true
    this.callbacks?.onStateChange('listening')

    this.stt.start({
      onPartial: (text) => this.callbacks?.onTranscript(text, false),
      onFinal: (text) => {
        this.expectSpokenReply = true
        this.callbacks?.onTranscript(text, true)
      },
      onError: (err) => {
        this.callbacks?.onError(err)
        this.callbacks?.onStateChange('error')
      },
    })
  }

  sendAudioChunk(data: Buffer): void {
    this.stt?.sendAudio(data)
  }

  stopListening(): void {
    this.stt?.stop()
    this.stt = null
    this.isListening = false
    this.callbacks?.onStateChange('idle')
  }

  getIsListening(): boolean {
    return this.isListening
  }

  /**
   * True if the last user turn came from voice — the caller (LLM IPC
   * handler) should speak its response and then clear the flag.
   */
  consumeExpectSpokenReply(): boolean {
    const expected = this.expectSpokenReply
    this.expectSpokenReply = false
    return expected
  }

  async speak(text: string, config: { elevenLabsApiKey: string; voiceId?: string }): Promise<void> {
    if (!config.elevenLabsApiKey || !text.trim()) return

    // Avoid transcribing our own voice back through the mic.
    if (this.isListening) this.stopListening()

    if (!this.tts || this.ttsVoiceId !== config.voiceId) {
      this.tts = new TextToSpeech(config.elevenLabsApiKey, config.voiceId)
      this.ttsVoiceId = config.voiceId
    }

    this.callbacks?.onStateChange('speaking')
    try {
      for await (const chunk of this.tts.speakStream(text)) {
        this.callbacks?.onAudio(chunk)
      }
    } catch (err) {
      this.callbacks?.onError(err as Error)
      this.callbacks?.onStateChange('error')
      return
    }
    this.callbacks?.onStateChange('idle')
  }
}

export const voiceManager = new VoiceManager()
