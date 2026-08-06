import { createClient, LiveTranscriptionEvents, type ListenLiveClient } from '@deepgram/sdk'

export class SpeechToText {
  private client
  private connection: ListenLiveClient | null = null
  // Deepgram marks a chunk is_final as soon as it won't be re-transcribed —
  // that happens repeatedly while the user keeps talking, it does not mean
  // they're done. Segments are buffered here and only flushed as a single
  // onFinal call on real end-of-speech (UtteranceEnd) or stop(), so one
  // spoken turn produces exactly one transcript instead of one per chunk.
  private finalizedSegments: string[] = []
  private onFinalCallback: ((text: string) => void) | null = null

  constructor(apiKey: string) {
    this.client = createClient(apiKey)
  }

  /**
   * Open a real-time WebSocket connection to Deepgram.
   * Transcript fragments arrive via the onPartial/onFinal callbacks
   * (onFinal fires once per utterance, on UtteranceEnd or stop()).
   */
  start(options: {
    onPartial: (text: string) => void
    onFinal: (text: string) => void
    onError: (error: Error) => void
  }): void {
    this.finalizedSegments = []
    this.onFinalCallback = options.onFinal

    const connection = this.client.listen.live({
      model: 'nova-3',
      // 'multi' enables Nova-3 code-switching (EN/JA and others) instead of
      // forcing every utterance through an English-only model — Japanese
      // speech transcribed as English previously produced garbled phonetic
      // text that then sent the LLM (and the voice reply) into confused,
      // hallucinatory rambling.
      language: 'multi',
      smart_format: true, // Punctuation, casing
      interim_results: true, // Partial transcripts while speaking
      utterance_end_ms: 1500, // Silence threshold for end of utterance
      vad_events: true, // Voice activity detection
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
    })
    this.connection = connection

    connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
      const text = data.channel?.alternatives?.[0]?.transcript || ''
      if (!text) return

      if (data.is_final) {
        this.finalizedSegments.push(text)
        options.onPartial(this.finalizedSegments.join(' '))
      } else {
        options.onPartial([...this.finalizedSegments, text].join(' '))
      }
    })

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      this.flush()
    })

    connection.on(LiveTranscriptionEvents.Error, (err: any) => {
      options.onError(new Error(err?.message || 'Deepgram error'))
    })
  }

  private flush(): void {
    if (this.finalizedSegments.length === 0) return
    const text = this.finalizedSegments.join(' ')
    this.finalizedSegments = []
    this.onFinalCallback?.(text)
  }

  /**
   * Send raw audio data (16-bit PCM, 16kHz, mono) to Deepgram.
   * Call this repeatedly with mic chunks from the renderer.
   */
  sendAudio(audioData: Buffer): void {
    const arrayBuffer = audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength)
    this.connection?.send(arrayBuffer)
  }

  /**
   * Close the WebSocket connection.
   */
  stop(): void {
    this.flush()
    if (this.connection) {
      this.connection.requestClose()
      this.connection = null
    }
    this.onFinalCallback = null
  }
}
