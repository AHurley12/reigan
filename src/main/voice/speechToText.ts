import { createClient, LiveTranscriptionEvents, type ListenLiveClient } from '@deepgram/sdk'

export class SpeechToText {
  private client
  private connection: ListenLiveClient | null = null

  constructor(apiKey: string) {
    this.client = createClient(apiKey)
  }

  /**
   * Open a real-time WebSocket connection to Deepgram.
   * Transcript fragments arrive via the onPartial/onFinal callbacks
   * (onFinal fires when Deepgram marks the segment is_final).
   */
  start(options: {
    onPartial: (text: string) => void
    onFinal: (text: string) => void
    onError: (error: Error) => void
  }): void {
    const connection = this.client.listen.live({
      model: 'nova-3',
      language: 'en',
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
        options.onFinal(text)
      } else {
        options.onPartial(text)
      }
    })

    connection.on(LiveTranscriptionEvents.Error, (err: any) => {
      options.onError(new Error(err?.message || 'Deepgram error'))
    })
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
    if (this.connection) {
      this.connection.requestClose()
      this.connection = null
    }
  }
}
