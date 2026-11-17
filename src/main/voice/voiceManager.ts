import { SpeechToText } from './speechToText'
import { TextToSpeech, type SpeechContext } from './textToSpeech'
import { planSpeech, MAX_TOTAL_CHARS, type SpeechSegment } from './prepareSpeech'
import { SpeakableTextBuffer } from './speakableText'
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

/**
 * Completed text below this is held back until more arrives (or the reply
 * ends), so later requests carry enough text for a steady delivery.
 */
export const STREAM_BATCH_MIN_CHARS = 250

export interface SpeakConfig {
  elevenLabsApiKey: string
  voiceId?: string
  stability?: number
  similarityBoost?: number
}

/** A reply being spoken while it is generated. */
export interface SpokenReply {
  /** Streamed reply text, as it arrives. */
  push(text: string): void
  /** The reply is complete; speak what remains. Resolves once every request is done. */
  finish(): Promise<void>
  /** Stop: nothing further is requested. Audio already sent still plays out. */
  cancel(): void
}

const SILENT_REPLY: SpokenReply = { push: () => {}, finish: () => Promise.resolve(), cancel: () => {} }

interface VoiceManagerCallbacks {
  onTranscript: (text: string, isFinal: boolean) => void
  onAudio: (audioBuffer: Buffer) => void
  onStateChange: (state: VoiceState) => void
  onError: (error: Error) => void
}

/**
 * Orchestrates Deepgram STT and ElevenLabs TTS. Owns a "voice turn" flag:
 * once a final transcript arrives, the next LLM response is spoken as it
 * streams, then the manager returns to idle.
 */
export class VoiceManager {
  private stt: SpeechToText | null = null
  private tts: TextToSpeech | null = null
  private ttsVoiceId: string | undefined
  private isListening = false
  private expectSpokenReply = false
  private activeReply: { cancelled: boolean; cancel: () => void } | null = null
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

  /**
   * Starts speaking a reply that is still being generated. Text is pushed in
   * as it streams; each completed sentence is planned and sent to ElevenLabs
   * while the model is still writing the rest, so the voice reads along with
   * the transcript instead of starting after it.
   *
   * The first sentence goes out alone so speech starts as early as possible.
   * After that, completed text is batched to at least STREAM_BATCH_MIN_CHARS
   * per request — ElevenLabs states that more text per generation gives better
   * audio, and its own streaming-input default (chunk_length_schedule
   * 120/160/250/290) makes the same trade. The first sentence buys that time:
   * it is still playing while the next batch is generated.
   */
  beginSpokenReply(config: SpeakConfig): SpokenReply {
    if (!config.elevenLabsApiKey) {
      this.callbacks?.onError(new Error('No ElevenLabs API key configured. Add it in Settings to hear spoken replies.'))
      return SILENT_REPLY
    }

    // One voice at a time. A new reply silences any older one still going —
    // otherwise two replies' audio would interleave in the playback queue.
    this.activeReply?.cancel()

    if (!this.tts || this.ttsVoiceId !== config.voiceId) {
      this.tts = new TextToSpeech(config.elevenLabsApiKey, config.voiceId)
      this.ttsVoiceId = config.voiceId
    }
    const tts = this.tts
    tts.setVoiceSettings(config.stability ?? 0.7, config.similarityBoost ?? 0.75)

    const buffer = new SpeakableTextBuffer()
    let ready = ''
    let finished = false
    let wake: (() => void) | null = null
    const notify = () => {
      wake?.()
      wake = null
    }

    const token = {
      cancelled: false,
      cancel: () => {
        token.cancelled = true
        notify()
      },
    }
    this.activeReply = token
    // Only the reply that still owns the voice may report its end. One that
    // was displaced by a newer reply must not knock that reply's 'speaking'
    // back to idle.
    const owns = () => this.activeReply === token

    const run = async (): Promise<void> => {
      let started = false
      let spokenChars = 0
      let previous: SpeechSegment | undefined
      try {
        while (!token.cancelled) {
          const due = ready.trim() !== '' && (!started || finished || ready.length >= STREAM_BATCH_MIN_CHARS)
          if (!due) {
            if (finished) break
            await new Promise<void>((resolve) => {
              wake = resolve
            })
            continue
          }
          const batch = ready
          ready = ''

          // Markdown, tables and the romaji gloss are stripped; each language
          // gets its own language-locked request.
          const segments = planSpeech(batch, MAX_TOTAL_CHARS - spokenChars)
          for (let i = 0; i < segments.length && !token.cancelled; i++) {
            if (!started) {
              started = true
              // Avoid transcribing our own voice back through the mic.
              if (this.isListening) this.stopListening()
              this.callbacks?.onStateChange('speaking')
            }
            const segment = segments[i]
            const sameLanguage = (other?: SpeechSegment) =>
              other?.languageCode === segment.languageCode ? other.text : undefined
            // previous_text carries delivery across requests, including across
            // batches. next_text is only known within a batch — the rest of the
            // reply has not been written yet.
            await this.streamSegment(
              tts,
              segment,
              { previousText: sameLanguage(previous), nextText: sameLanguage(segments[i + 1]) },
              token
            )
            spokenChars += segment.text.length
            previous = segment
          }
          if (spokenChars >= MAX_TOTAL_CHARS) break
        }
      } catch (err) {
        const { statusCode, message } = describeTtsFailure(err)

        // Recorded here rather than left to the caller. A failure is reported
        // through onError and the promise still resolves, so a `.catch()` on
        // it never runs — which is why a spoken reply could fail on every
        // attempt and leave the error log empty.
        recordAppError({
          source: 'voice',
          operation: 'speak',
          error: err instanceof Error ? err : new Error(message),
          severity: 'warning',
          context: {
            statusCode: statusCode ?? null,
            voiceId: this.ttsVoiceId ?? null,
            consequence: started ? 'reply was only partly spoken' : 'reply was shown but not spoken',
          },
        })

        token.cancelled = true
        if (owns()) {
          this.activeReply = null
          this.callbacks?.onError(new Error(message))
          this.callbacks?.onStateChange('error')
        }
        return
      }
      if (owns()) {
        this.activeReply = null
        if (started) this.callbacks?.onStateChange('idle')
      }
    }

    const done = run()
    return {
      push: (text) => {
        if (token.cancelled || finished) return
        ready += buffer.push(text)
        if (ready) notify()
      },
      finish: () => {
        if (!finished) {
          finished = true
          ready += buffer.flush()
          notify()
        }
        return done
      },
      cancel: () => token.cancel(),
    }
  }

  /** Streams one planned segment to the renderer, chunk by chunk. */
  private async streamSegment(
    tts: TextToSpeech,
    segment: SpeechSegment,
    context: SpeechContext,
    token: { cancelled: boolean }
  ): Promise<void> {
    const stream = tts.speakStream(segment.text, segment.languageCode, context)
    while (true) {
      const { value: chunk, done } = await withTimeout(stream.next(), TTS_CHUNK_TIMEOUT_MS)
      if (done) return
      if (token.cancelled) {
        await stream.return?.(undefined)
        return
      }
      this.callbacks?.onAudio(chunk)
    }
  }

  /** Skip the in-progress spoken reply — stops generating further audio and returns to idle. */
  stopSpeaking(): void {
    this.activeReply?.cancel()
  }
}

export const voiceManager = new VoiceManager()
