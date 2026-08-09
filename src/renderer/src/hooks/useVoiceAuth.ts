import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore, failureMessage } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { startCapture, type CaptureEnd, type CaptureHandle } from '../voice/authCapture'
import { UNLOCK_TIMING } from '../components/Lock/timing'
import type { AuthPhase, EnrollSampleResult } from '../../../shared/auth-types'

/**
 * Drives the lock screen: capture → verify → phase transitions.
 *
 * The capture handle lives in a ref rather than state. Putting it in state
 * would re-render the tree on every start/stop, and the waveform canvas reads
 * the analyser through that same ref on its own rAF loop — so audio
 * visualisation costs exactly zero React renders while listening, which is the
 * point of the debounced-re-render requirement.
 */

/** How long the failure animation holds before returning to idle. */
const FAILURE_HOLD_MS = 1600

export interface VoiceAuthController {
  phase: AuthPhase
  message: string | null
  /** Read by the waveform canvas. Null when not capturing. */
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  startUnlock: () => Promise<void>
  cancel: () => void
  unlockWithPassphrase: (passphrase: string) => Promise<boolean>
  lockNow: () => Promise<void>
}

export function useVoiceAuth(): VoiceAuthController {
  const phase = useAuthStore((s) => s.phase)
  const message = useAuthStore((s) => s.message)
  const deviceId = useSettingsStore((s) => s.settings.audioInputDeviceId)

  const captureRef = useRef<CaptureHandle | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const challengeIdRef = useRef<string | undefined>(undefined)
  const timersRef = useRef<number[]>([])
  const busyRef = useRef(false)

  const schedule = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms)
    timersRef.current.push(id)
  }, [])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])

  const teardownCapture = useCallback(() => {
    captureRef.current?.abort()
    captureRef.current = null
    analyserRef.current = null
  }, [])

  // Abort capture if the component goes away mid-utterance. Without this the
  // mic stays open — and the OS indicator stays lit — after the lock screen
  // has been replaced by the unlocked shell.
  useEffect(() => {
    return () => {
      clearTimers()
      teardownCapture()
    }
  }, [clearTimers, teardownCapture])

  const submit = useCallback(async () => {
    const handle = captureRef.current
    if (!handle) return

    const store = useAuthStore.getState()
    store.setPhase('processing')

    const { pcm, reason } = await handle.stop()
    captureRef.current = null
    analyserRef.current = null

    if (reason === 'no-speech' || pcm.length === 0) {
      store.setMessage(failureMessage('no-speech'))
      store.setPhase('failed')
      schedule(() => {
        useAuthStore.getState().setPhase('idle')
        busyRef.current = false
      }, FAILURE_HOLD_MS)
      return
    }

    try {
      const result = await window.reigan.auth.verify(
        pcm.buffer as ArrayBuffer,
        handle.sampleRate,
        challengeIdRef.current
      )

      if (result.ok) {
        store.setMessage(null)
        store.setSessionExpiry(result.sessionExpiresAt ?? 0)
        store.setPhase('unlocking')
        // The reveal runs locally; main has already flipped the real state and
        // broadcast it, so nothing here gates on the animation finishing.
        schedule(() => {
          busyRef.current = false
        }, UNLOCK_TIMING.revealMs)
        return
      }

      store.setMessage(failureMessage(result.reason))
      const cooling = (result.cooldownUntil ?? 0) > Date.now()
      store.setPhase('failed')
      schedule(
        () => {
          useAuthStore.getState().setPhase(cooling ? 'cooldown' : 'idle')
          busyRef.current = false
        },
        FAILURE_HOLD_MS
      )
    } catch {
      store.setMessage(failureMessage('internal'))
      store.setPhase('failed')
      schedule(() => {
        useAuthStore.getState().setPhase('idle')
        busyRef.current = false
      }, FAILURE_HOLD_MS)
    } finally {
      challengeIdRef.current = undefined
    }
  }, [schedule])

  const startUnlock = useCallback(async () => {
    if (busyRef.current) return
    const store = useAuthStore.getState()
    if (store.status?.cooldownUntil && store.status.cooldownUntil > Date.now()) return

    busyRef.current = true
    clearTimers()
    store.setMessage(null)

    try {
      const challenge = await window.reigan.auth.challenge()
      challengeIdRef.current = challenge.id
      store.setChallenge(challenge)

      const handle = await startCapture({
        deviceId,
        onAutoStop: (reason: CaptureEnd) => {
          // Fire-and-forget: submit() owns the rest of the state machine.
          if (reason !== 'manual') void submit()
        },
      })
      captureRef.current = handle
      analyserRef.current = handle.analyser
      store.setPhase('listening')
    } catch (err) {
      busyRef.current = false
      store.setChallenge(null)
      store.setMessage(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Microphone access denied. Use your passphrase.'
          : 'Microphone unavailable. Use your passphrase.'
      )
      store.setPhase('failed')
      schedule(() => useAuthStore.getState().setPhase('idle'), FAILURE_HOLD_MS)
    }
  }, [deviceId, submit, schedule, clearTimers])

  const cancel = useCallback(() => {
    clearTimers()
    teardownCapture()
    challengeIdRef.current = undefined
    busyRef.current = false
    const store = useAuthStore.getState()
    store.setChallenge(null)
    store.setMessage(null)
    store.setPhase('idle')
  }, [clearTimers, teardownCapture])

  const unlockWithPassphrase = useCallback(async (passphrase: string): Promise<boolean> => {
    const store = useAuthStore.getState()
    store.setPhase('processing')
    try {
      const result = await window.reigan.auth.verifyPassphrase(passphrase)
      if (result.ok) {
        store.setMessage(null)
        store.setSessionExpiry(result.sessionExpiresAt ?? 0)
        store.setPhase('unlocking')
        return true
      }
      store.setMessage(failureMessage(result.reason))
      const cooling = (result.cooldownUntil ?? 0) > Date.now()
      store.setPhase('failed')
      schedule(() => {
        useAuthStore.getState().setPhase(cooling ? 'cooldown' : 'idle')
      }, FAILURE_HOLD_MS)
      return false
    } catch {
      store.setMessage(failureMessage('internal'))
      store.setPhase('idle')
      return false
    }
  }, [schedule])

  const lockNow = useCallback(async () => {
    cancel()
    await window.reigan.auth.lock()
  }, [cancel])

  return { phase, message, analyserRef, startUnlock, cancel, unlockWithPassphrase, lockNow }
}

/**
 * Enrolment capture. Kept separate from the unlock controller because it has a
 * different shape — the caller drives each take explicitly rather than the
 * state machine driving itself.
 */
export function useEnrollmentCapture(): {
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  recording: boolean
  recordSample: () => Promise<EnrollSampleResult | null>
  abort: () => void
} {
  const deviceId = useSettingsStore((s) => s.settings.audioInputDeviceId)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const captureRef = useRef<CaptureHandle | null>(null)
  // Both a ref and state: the ref guards re-entrancy synchronously, the state
  // is what actually re-renders the "recording" affordance.
  const recordingRef = useRef(false)
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    return () => {
      captureRef.current?.abort()
      captureRef.current = null
      analyserRef.current = null
    }
  }, [])

  const recordSample = useCallback(async (): Promise<EnrollSampleResult | null> => {
    if (recordingRef.current) return null
    recordingRef.current = true
    setRecording(true)
    try {
      // Wait for the utterance to end on its own rather than calling stop(),
      // which would cut the recording off the instant it started.
      let signalDone: () => void = () => {}
      const ended = new Promise<void>((resolve) => {
        signalDone = resolve
      })

      const handle = await startCapture({ deviceId, onAutoStop: () => signalDone() })
      captureRef.current = handle
      analyserRef.current = handle.analyser

      await ended
      const { pcm } = await handle.stop()

      captureRef.current = null
      analyserRef.current = null
      if (pcm.length === 0) return null

      return await window.reigan.auth.enrollSample(pcm.buffer as ArrayBuffer, handle.sampleRate)
    } catch {
      return null
    } finally {
      recordingRef.current = false
      setRecording(false)
    }
  }, [deviceId])

  const abort = useCallback(() => {
    captureRef.current?.abort()
    captureRef.current = null
    analyserRef.current = null
    recordingRef.current = false
    setRecording(false)
  }, [])

  return { analyserRef, recording, recordSample, abort }
}
