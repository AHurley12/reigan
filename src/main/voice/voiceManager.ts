import { SpeechToText } from './speechToText'
import { TextToSpeech } from './textToSpeech'
import { prepareForSpeech } from './prepareSpeech'

// Failsafe: if ElevenLabs stalls mid-stream (hung connection, runaway
// generation) instead of erroring outright, don't let the app sit in
// "speaking" state forever — bail out and return to idle.
const TTS_CHUNK_TIMEOUT_MS = 15_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('TTS stream stalled — no audio received in time.')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) }
    )
  })
}

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
  private speakCancelled = false
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

  async speak(
    text: string,
    config: { elevenLabsApiKey: string; voiceId?: string; stability?: number; similarityBoost?: number }
  ): Promise<void> {
    if (!text.trim()) return
    if (!config.elevenLabsApiKey) {
      this.callbacks?.onError(new Error('No ElevenLabs API key configured. Add it in Settings to hear spoken replies.'))
      return
    }

    // Avoid transcribing our own voice back through the mic.
    if (this.isListening) this.stopListening()

    if (!this.tts || this.ttsVoiceId !== config.voiceId) {
      this.tts = new TextToSpeech(config.elevenLabsApiKey, config.voiceId)
      this.ttsVoiceId = config.voiceId
    }
    this.tts.setVoiceSettings(config.stability ?? 0.7, config.similarityBoost ?? 0.75)

    // Speak only the text the user will actually see, in one language —
    // strips markdown and the bilingual (romaji/English) gloss so the model
    // isn't asked to pronounce the same idea twice in different scripts.
    const { text: speechText, languageCode } = prepareForSpeech(text)
    if (!speechText) return

    this.speakCancelled = false
    this.callbacks?.onStateChange('speaking')
    try {
      const stream = this.tts.speakStream(speechText, languageCode)
      while (true) {
        const { value: chunk, done } = await withTimeout(stream.next(), TTS_CHUNK_TIMEOUT_MS)
        if (done) break
        if (this.speakCancelled) {
          await stream.return?.(undefined)
          break
        }
        this.callbacks?.onAudio(chunk)
      }
    } catch (err) {
      const statusCode = (err as { statusCode?: number; status?: number })?.statusCode ?? (err as { status?: number })?.status
      const message =
        statusCode === 402
          ? 'ElevenLabs rejected this request (402) — either this voice isn\'t included in your plan, or you\'re out of character quota. Try a different voice in Settings, or check your ElevenLabs account.'
          : (err as Error).message
      this.callbacks?.onError(new Error(message))
      this.callbacks?.onStateChange('error')
      return
    }
    this.callbacks?.onStateChange('idle')
  }

  /** Skip the in-progress spoken reply — stops generating further audio and returns to idle. */
  stopSpeaking(): void {
    this.speakCancelled = true
  }
}

export const voiceManager = new VoiceManager()
