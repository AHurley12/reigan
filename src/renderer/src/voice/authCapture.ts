/**
 * Microphone capture for authentication.
 *
 * Separate from voiceController.ts on purpose. That pipeline streams to a
 * cloud STT service and is tuned for intelligibility; this one accumulates raw
 * PCM locally, hands it to the main process, and never touches the network.
 * Sharing the graph would mean one set of constraints serving two incompatible
 * goals, and would make it far too easy to accidentally route passphrase audio
 * into a transcription socket.
 *
 * Reuses the existing /worklets/mic-processor.js so capture stays off the main
 * thread — the lock screen is animating while this runs.
 */

import { AUTH_DEFAULTS } from '../../../shared/auth-types'

const TARGET_SAMPLE_RATE = 16_000

/** Chunk RMS above this starts the utterance. */
const SPEECH_ON_RMS = 0.02
/** Chunk RMS below this counts towards the trailing-silence timer. */
const SPEECH_OFF_RMS = 0.012
/** Trailing silence that ends the utterance, once speech has started. */
const ENDPOINT_SILENCE_MS = 800
/** Give up if the user never starts speaking. */
const NO_SPEECH_TIMEOUT_MS = 7_000

export type CaptureEnd = 'endpoint' | 'max-duration' | 'no-speech' | 'manual' | 'error'

export interface CaptureHandle {
  /** Live analyser for the waveform canvas. Read directly — never through React state. */
  analyser: AnalyserNode
  sampleRate: number
  /** Stops capture and resolves with the accumulated mono PCM. */
  stop(reason?: CaptureEnd): Promise<{ pcm: Float32Array; reason: CaptureEnd }>
  /** Tears down without resolving a payload. */
  abort(): void
}

export interface CaptureOptions {
  deviceId?: string
  /** Fires when the utterance self-terminates so the caller can submit. */
  onAutoStop?: (reason: CaptureEnd) => void
}

/**
 * Constraints deliberately differ from voiceController's.
 *
 * Automatic gain control and noise suppression are disabled here: both are
 * non-linear, signal-dependent transforms, and they are exactly the parts of
 * the signal a speaker comparison keys on. Leaving them on makes the same
 * person score differently depending on how loudly they happen to speak.
 *
 * What matters most is that enrolment and verification use *identical*
 * constraints, so this function is the single source for both paths.
 */
function micConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      ...(deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : {}),
      channelCount: 1,
      sampleRate: TARGET_SAMPLE_RATE,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  }
}

export async function startCapture(options: CaptureOptions = {}): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia(micConstraints(options.deviceId))
  const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })

  let node: AudioWorkletNode
  try {
    await context.audioWorklet.addModule('/worklets/mic-processor.js')
    node = new AudioWorkletNode(context, 'mic-processor')
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop())
    await context.close()
    throw err
  }

  const source = context.createMediaStreamSource(stream)
  const analyser = context.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.75

  // The worklet only runs while its graph reaches a destination, but routing
  // the mic to the speakers would create a feedback loop — same reasoning as
  // voiceController.ts. A zero gain node terminates the graph silently.
  const mute = context.createGain()
  mute.gain.value = 0

  source.connect(analyser)
  source.connect(node)
  node.connect(mute)
  mute.connect(context.destination)

  const chunks: Float32Array[] = []
  let total = 0
  let speechStarted = false
  let silenceMs = 0
  let elapsedMs = 0
  let settled = false

  // The utterance usually ends on its own (endpoint/timeout) *before* the
  // caller gets around to calling stop(). Park the result so a later stop()
  // still resolves with real audio instead of an empty buffer.
  let finished: { pcm: Float32Array; reason: CaptureEnd } | null = null
  let resolveStop: ((v: { pcm: Float32Array; reason: CaptureEnd }) => void) | null = null

  const chunkMs = (4096 / TARGET_SAMPLE_RATE) * 1000 // 256 ms

  const teardown = async (): Promise<void> => {
    node.port.onmessage = null
    try {
      node.disconnect()
      source.disconnect()
      analyser.disconnect()
      mute.disconnect()
    } catch {
      // Graph may already be partially torn down.
    }
    stream.getTracks().forEach((t) => t.stop())
    try {
      await context.close()
    } catch {
      // Already closed.
    }
  }

  /**
   * Assembles the payload *before* tearing the graph down.
   *
   * Ordering is load-bearing: teardown is async, and onAutoStop consumers
   * immediately call stop() expecting the audio to be ready. Parking the
   * payload first means there is no window where the capture has ended but
   * stop() would hand back an empty buffer.
   */
  const finish = (reason: CaptureEnd): void => {
    if (settled) return
    settled = true

    const pcm = new Float32Array(total)
    let offset = 0
    for (const c of chunks) {
      pcm.set(c, offset)
      offset += c.length
    }
    // Drop our references promptly — this is the user's voice sitting in the
    // renderer heap, and it has no reason to outlive the request.
    chunks.length = 0

    finished = { pcm, reason }
    resolveStop?.(finished)
    resolveStop = null

    void teardown()
    if (reason !== 'manual') options.onAutoStop?.(reason)
  }

  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (settled) return
    const chunk = e.data
    chunks.push(chunk)
    total += chunk.length
    elapsedMs += chunkMs

    let sumSquares = 0
    for (let i = 0; i < chunk.length; i++) sumSquares += chunk[i] * chunk[i]
    const rms = Math.sqrt(sumSquares / chunk.length)

    if (!speechStarted) {
      if (rms >= SPEECH_ON_RMS) {
        speechStarted = true
        silenceMs = 0
      } else if (elapsedMs >= NO_SPEECH_TIMEOUT_MS) {
        finish('no-speech')
      }
      return
    }

    silenceMs = rms < SPEECH_OFF_RMS ? silenceMs + chunkMs : 0

    if (silenceMs >= ENDPOINT_SILENCE_MS) {
      finish('endpoint')
      return
    }
    if (elapsedMs >= AUTH_DEFAULTS.maxUtteranceMs) {
      finish('max-duration')
    }
  }

  return {
    analyser,
    sampleRate: context.sampleRate,
    stop(reason: CaptureEnd = 'manual') {
      return new Promise((resolve) => {
        // Already ended on its own — hand back what was captured.
        if (finished) {
          resolve(finished)
          return
        }
        if (settled) {
          resolve({ pcm: new Float32Array(0), reason })
          return
        }
        resolveStop = resolve
        finish(reason)
      })
    },
    abort() {
      settled = true
      finished = null
      chunks.length = 0
      void teardown()
    },
  }
}
