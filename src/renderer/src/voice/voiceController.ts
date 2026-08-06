import { useAppStore } from '../stores/appStore'
import { useVoiceStore } from '../stores/voiceStore'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToastStore } from '../stores/toastStore'
import { validateStoredAudioDevices } from './audioDeviceManager'
import type { ReiganState } from '../../../shared/types'

let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let workletNode: AudioWorkletNode | null = null
let muteNode: GainNode | null = null
let playbackContext: AudioContext | null = null
let listenersInitialized = false
let devicesValidated = false

function micConstraints(deviceId: string | undefined): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  }
}

function describeMicError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
        return 'Microphone access denied — check Windows Settings → Privacy & Security → Microphone (both "Microphone access" and "Let desktop apps access your microphone" must be on).'
      case 'NotFoundError':
        return 'No microphone found — check your device connection.'
      case 'NotReadableError':
        return 'Microphone is in use by another application.'
      case 'OverconstrainedError':
        return 'Selected microphone does not support the required audio format.'
      default:
        return `Microphone error: ${err.message}`
    }
  }
  return 'Microphone access failed.'
}

/**
 * Mic capture follows the main process's authoritative voice state rather
 * than being started directly by the UI — the global push-to-talk shortcut
 * can start listening without the renderer's mic button ever being clicked,
 * so this is the one place that has to work for both triggers.
 */
async function startMicCapture(): Promise<void> {
  if (audioContext || !window.reigan) return
  const toast = useToastStore.getState().push
  const selectedDeviceId = useSettingsStore.getState().settings.audioInputDeviceId

  try {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia(micConstraints(selectedDeviceId))
    } catch (err) {
      // A specifically-selected device that's gone (unplugged) shouldn't just
      // fail silently — fall back to the system default and keep listening.
      const deviceSpecific = selectedDeviceId && selectedDeviceId !== 'default'
      const recoverable = err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError')
      if (deviceSpecific && recoverable) {
        toast('Selected microphone unavailable — switched to system default.', 'warning')
        useSettingsStore.getState().set('audioInputDeviceId', 'default')
        mediaStream = await navigator.mediaDevices.getUserMedia(micConstraints('default'))
      } else {
        throw err
      }
    }

    audioContext = new AudioContext({ sampleRate: 16000 })
    const source = audioContext.createMediaStreamSource(mediaStream)

    // AudioWorkletProcessor runs on the audio thread, not the main thread —
    // WebGL rendering (orb, avatar) on the main thread can no longer starve
    // mic capture. Chunking to 4096 samples happens inside the worklet so
    // this posts messages at the same cadence the old ScriptProcessorNode did.
    await audioContext.audioWorklet.addModule('/worklets/mic-processor.js')
    workletNode = new AudioWorkletNode(audioContext, 'mic-processor')

    workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const float32 = e.data
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

    // AudioWorkletNode only processes while part of a graph that reaches the
    // destination — route through a silent gain node instead of connecting
    // directly, otherwise this monitors the live mic straight out the
    // speakers. On non-headphone setups that's a real feedback loop (mic ->
    // speaker -> mic) landing ~256ms later, which sounds exactly like the
    // reported "repeating voice" / delay.
    muteNode = audioContext.createGain()
    muteNode.gain.value = 0
    source.connect(workletNode)
    workletNode.connect(muteNode)
    muteNode.connect(audioContext.destination)
  } catch (err) {
    console.error('Microphone access failed:', err)
    toast(describeMicError(err), 'error')
    stopMicCapture()
    window.reigan?.voice.stopListening()
  }
}

function stopMicCapture(): void {
  workletNode?.port.close()
  workletNode?.disconnect()
  muteNode?.disconnect()
  mediaStream?.getTracks().forEach((t) => t.stop())
  audioContext?.close()
  workletNode = null
  muteNode = null
  mediaStream = null
  audioContext = null
}

async function ensurePlaybackContext(): Promise<AudioContext> {
  if (!playbackContext) playbackContext = new AudioContext({ sampleRate: 22050 })

  const outputDeviceId = useSettingsStore.getState().settings.audioOutputDeviceId
  const ctxWithSink = playbackContext as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  if (outputDeviceId && outputDeviceId !== 'default' && typeof ctxWithSink.setSinkId === 'function') {
    try {
      await ctxWithSink.setSinkId(outputDeviceId)
    } catch (err) {
      console.error('Failed to switch playback output device:', err)
      useToastStore.getState().push('Could not switch playback to the selected output device — using system default.', 'warning')
    }
  }
  return playbackContext
}

// Electron's IPC delivers a main-process Buffer to the renderer as a Uint8Array,
// not the ArrayBuffer its bytes logically represent — reinterpreting it directly
// (rather than re-copying element-by-element) is required to decode real PCM16
// samples instead of noise. ElevenLabs' stream chunks also land on arbitrary
// network boundaries, not 2-byte sample boundaries, so a trailing odd byte is
// carried over and prepended to the next chunk instead of corrupting the split sample.
let pendingAudioByte: Uint8Array | null = null
let nextPlayTime = 0
let activeSources: AudioBufferSourceNode[] = []
// Set while a skip is in flight so any playback chunks already en route over
// IPC (the main process learns about the skip a tick later) get dropped
// instead of resuming playback right after stopPlayback() clears it.
let voiceSkipped = false

async function playPcm16(chunk: Uint8Array): Promise<void> {
  let bytes = chunk
  if (pendingAudioByte) {
    const merged = new Uint8Array(pendingAudioByte.length + bytes.length)
    merged.set(pendingAudioByte, 0)
    merged.set(bytes, pendingAudioByte.length)
    bytes = merged
    pendingAudioByte = null
  }
  if (bytes.length % 2 !== 0) {
    pendingAudioByte = bytes.slice(bytes.length - 1)
    bytes = bytes.slice(0, bytes.length - 1)
  }
  if (bytes.length === 0) return

  const int16 = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.length / 2)
  const playbackContext = await ensurePlaybackContext()

  const audioBuffer = playbackContext.createBuffer(1, int16.length, 22050)
  const channel = audioBuffer.getChannelData(0)
  for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768

  const source = playbackContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(playbackContext.destination)
  source.onended = () => {
    activeSources = activeSources.filter((s) => s !== source)
  }
  activeSources.push(source)
  // Schedule back-to-back instead of each chunk calling start() at "now" —
  // otherwise fast-arriving chunks overlap and layer into garbled noise.
  const startAt = Math.max(playbackContext.currentTime, nextPlayTime)
  source.start(startAt)
  nextPlayTime = startAt + audioBuffer.duration
}

/** Immediately silences whatever's currently playing/queued. */
function stopPlayback(): void {
  for (const source of activeSources) {
    try {
      source.stop()
    } catch {
      // Already stopped/ended — fine.
    }
  }
  activeSources = []
  nextPlayTime = playbackContext?.currentTime ?? 0
  pendingAudioByte = null
}

export function startVoice(): void {
  window.reigan?.voice.startListening()
}

export function stopVoice(): void {
  window.reigan?.voice.stopListening()
}

/** Cuts off REIGAN's spoken reply mid-sentence and returns to idle. */
export function skipVoiceResponse(): void {
  voiceSkipped = true
  stopPlayback()
  window.reigan?.voice.stopSpeaking()
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
    if (voiceSkipped) return
    playPcm16(buffer)
  })

  const unsubState = window.reigan.voice.onStateChange((state) => {
    useAppStore.getState().setReiganState(state as ReiganState)
    useVoiceStore.getState().setActive(state === 'listening')
    if (state === 'listening') startMicCapture()
    else stopMicCapture()
    // A fresh speaking turn — clear any skip from the previous reply.
    if (state === 'speaking') voiceSkipped = false
  })

  const unsubOrb = window.reigan.voice.onOrbAudio((data) => {
    useVoiceStore.getState().setOrbAudio(data)
  })

  const unsubError = window.reigan.voice.onError((message) => {
    console.error('Voice error:', message)
    useToastStore.getState().push(message, 'error')
  })

  // Settings load asynchronously after mount — wait for hydration before
  // checking saved device selections against what's actually connected.
  const unsubSettingsLoaded = useSettingsStore.subscribe((state) => {
    if (state.loaded && !devicesValidated) {
      devicesValidated = true
      validateStoredAudioDevices()
    }
  })
  if (useSettingsStore.getState().loaded && !devicesValidated) {
    devicesValidated = true
    validateStoredAudioDevices()
  }

  return () => {
    listenersInitialized = false
    devicesValidated = false
    stopMicCapture()
    unsubTranscript()
    unsubAudio()
    unsubState()
    unsubOrb()
    unsubError()
    unsubSettingsLoaded()
  }
}
