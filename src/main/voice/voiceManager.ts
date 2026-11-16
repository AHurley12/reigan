import { SpeechToText } from './speechToText'
import { TextToSpeech } from './textToSpeech'
import { planSpeech } from './prepareSpeech'
import { describeTtsFailure } from './ttsError'
import { recordAppError } from '../errors/errorLog'

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

    // Markdown, tables and the romaji gloss are stripped; each language gets
    // its own language-locked request, and long replies are split at sentence
    // boundaries rather than cut off.
    const segments = planSpeech(text)
    if (segments.length === 0) return

    this.speakCancelled = false
    this.callbacks?.onStateChange('speaking')
    try {
      // Sequential, not parallel: ElevenLabs delivers far faster than real
      // time, so the next request completes while the previous segment is
      // still playing out of the renderer's queue.
      for (let i = 0; i < segments.length && !this.speakCancelled; i++) {
        const { text: segmentText, languageCode } = segments[i]
        const neighbour = (j: number) =>
          segments[j]?.languageCode === languageCode ? segments[j].text : undefined
        const stream = this.tts.speakStream(segmentText, languageCode, {
          previousText: neighbour(i - 1),
          nextText: neighbour(i + 1),
        })
        while (true) {
          const { value: chunk, done } = await withTimeout(stream.next(), TTS_CHUNK_TIMEOUT_MS)
          if (done) break
          if (this.speakCancelled) {
            await stream.return?.(undefined)
            break
          }
          this.callbacks?.onAudio(chunk)
        }
      }
    } catch (err) {
      const { statusCode, message } = describeTtsFailure(err)

      // Recorded here rather than left to the caller. `speak()` reports a
      // failure through onError and then returns normally, so the promise
      // resolves and a `.catch()` on it never runs — which is why a spoken
      // reply could fail on every attempt and leave the error log empty. The
      // one failure mode most worth having a trail for had none.
      recordAppError({
        source: 'voice',
        operation: 'speak',
        error: err instanceof Error ? err : new Error(message),
        severity: 'warning',
        context: {
          statusCode: statusCode ?? null,
          voiceId: this.ttsVoiceId ?? null,
          consequence: 'reply was shown but not spoken',
        },
      })

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
