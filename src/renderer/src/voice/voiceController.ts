import { useAppStore } from '../stores/appStore'
import { useVoiceStore } from '../stores/voiceStore'
import { useChatStore } from '../stores/chatStore'
import type { ReiganState } from '../../../shared/types'

let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let processor: ScriptProcessorNode | null = null
let playbackContext: AudioContext | null = null
let listenersInitialized = false

/**
 * Mic capture follows the main process's authoritative voice state rather
 * than being started directly by the UI — the global push-to-talk shortcut
 * can start listening without the renderer's mic button ever being clicked,
 * so this is the one place that has to work for both triggers.
 */
async function startMicCapture(): Promise<void> {
  if (audioContext || !window.reigan) return

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, sampleRate: 16000, echoCancellation: true, noiseSuppression: true },
    })

    audioContext = new AudioContext({ sampleRate: 16000 })
    const source = audioContext.createMediaStreamSource(mediaStream)
    // AudioWorklet would avoid the deprecated ScriptProcessorNode, but it
    // needs a separate worklet module to load — fine as a v1 tradeoff.
    processor = audioContext.createScriptProcessor(4096, 1, 1)

    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0)
      const int16 = new Int16Array(float32.length)
      let sumSquares = 0
      for (let i = 0; i < float32.length; i++) {
        const clamped = Math.max(-1, Math.min(1, float32[i]))
        int16[i] = clamped * 32768
        sumSquares += clamped * clamped
      }
      window.reigan.voice.sendAudioChunk(int16.buffer)
      window.reigan.voice.sendAmplitude(Math.sqrt(sumSquares / float32.length))
    }

    source.connect(processor)
    processor.connect(audioContext.destination)
  } catch (err) {
    console.error('Microphone access failed:', err)
    stopMicCapture()
    window.reigan?.voice.stopListening()
  }
}

function stopMicCapture(): void {
  processor?.disconnect()
  mediaStream?.getTracks().forEach((t) => t.stop())
  audioContext?.close()
  processor = null
  mediaStream = null
  audioContext = null
}

async function playPcm16(buffer: ArrayBuffer): Promise<void> {
  const int16 = new Int16Array(buffer)
  if (int16.length === 0) return
  if (!playbackContext) playbackContext = new AudioContext({ sampleRate: 22050 })

  const audioBuffer = playbackContext.createBuffer(1, int16.length, 22050)
  const channel = audioBuffer.getChannelData(0)
  for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768

  const source = playbackContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(playbackContext.destination)
  source.start()
}

export function startVoice(): void {
  window.reigan?.voice.startListening()
}

export function stopVoice(): void {
  window.reigan?.voice.stopListening()
}

/** Wires main-process voice IPC events to renderer state. Idempotent — safe to call once app-wide. */
export function initVoiceListeners(): () => void {
  if (listenersInitialized || !window.reigan) return () => {}
  listenersInitialized = true

  const unsubTranscript = window.reigan.voice.onTranscript(({ text, isFinal }) => {
    useVoiceStore.getState().setTranscript(text)
    if (isFinal) {
      useVoiceStore.getState().setTranscript('')
      useChatStore.getState().sendMessage(text)
    }
  })

  const unsubAudio = window.reigan.voice.onAudioPlayback((buffer) => {
    playPcm16(buffer)
  })

  const unsubState = window.reigan.voice.onStateChange((state) => {
    useAppStore.getState().setReiganState(state as ReiganState)
    useVoiceStore.getState().setActive(state === 'listening')
    if (state === 'listening') startMicCapture()
    else stopMicCapture()
  })

  const unsubOrb = window.reigan.voice.onOrbAudio((data) => {
    useVoiceStore.getState().setOrbAudio(data)
  })

  const unsubError = window.reigan.voice.onError((message) => {
    console.error('Voice error:', message)
  })

  return () => {
    listenersInitialized = false
    stopMicCapture()
    unsubTranscript()
    unsubAudio()
    unsubState()
    unsubOrb()
    unsubError()
  }
}
