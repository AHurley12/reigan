/**
 * Context-bridge surface for voice authentication.
 *
 * Follows Reigan's existing preload shape: a plain object of thin wrappers,
 * merged into the single `window.reigan` exposure in index.ts rather than
 * calling exposeInMainWorld a second time. One bridge, one audit point.
 *
 * The bridge deliberately exposes no way to read the voiceprint, the threshold,
 * or any similarity score. Audio goes in, a verdict comes out. Everything the
 * renderer can reach is either a command or a status the lock screen has to be
 * able to render anyway.
 */

import { ipcRenderer } from 'electron'
import {
  AUTH_IPC,
  type AuthStateEvent,
  type AuthStatus,
  type EnrollCommitResult,
  type EnrollSampleResult,
  type LivenessChallenge,
  type VerifyResult,
  type VoiceAuthBridge,
} from '../shared/auth-types'

/** Typed against the shared contract so preload and renderer cannot drift. */
export const authBridge: VoiceAuthBridge = {
  status: (): Promise<AuthStatus> => ipcRenderer.invoke(AUTH_IPC.STATUS),

  // ── Enrolment ──
  enrollBegin: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(AUTH_IPC.ENROLL_BEGIN),

  /**
   * `pcm` must be a transferable ArrayBuffer of Float32 mono samples. Callers
   * should pass a buffer they no longer own — structured clone copies it, so
   * retaining it just keeps a second copy of the user's voice alive in the
   * renderer heap for no reason.
   */
  enrollSample: (pcm: ArrayBuffer, sampleRate: number): Promise<EnrollSampleResult> =>
    ipcRenderer.invoke(AUTH_IPC.ENROLL_SAMPLE, { pcm, sampleRate }),

  enrollCommit: (fallbackPassphrase: string): Promise<EnrollCommitResult> =>
    ipcRenderer.invoke(AUTH_IPC.ENROLL_COMMIT, fallbackPassphrase),

  enrollCancel: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(AUTH_IPC.ENROLL_CANCEL),

  reset: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(AUTH_IPC.RESET),

  // ── Unlocking ──
  challenge: (): Promise<LivenessChallenge> => ipcRenderer.invoke(AUTH_IPC.CHALLENGE),

  verify: (pcm: ArrayBuffer, sampleRate: number, challengeId?: string): Promise<VerifyResult> =>
    ipcRenderer.invoke(AUTH_IPC.VERIFY, { pcm, sampleRate, challengeId }),

  verifyPassphrase: (passphrase: string): Promise<VerifyResult> =>
    ipcRenderer.invoke(AUTH_IPC.VERIFY_FALLBACK, passphrase),

  lock: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(AUTH_IPC.LOCK),

  /** 0 disables auto-lock entirely. Persisted in main. */
  setIdleTimeout: (ms: number): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke(AUTH_IPC.SET_IDLE_TIMEOUT, ms),

  /** Debounced by the renderer — see useVoiceAuth's activity ping. */
  ping: (): void => ipcRenderer.send(AUTH_IPC.ACTIVITY),

  onStateChanged: (callback: (event: AuthStateEvent) => void): (() => void) => {
    const handler = (_: unknown, event: AuthStateEvent): void => callback(event)
    ipcRenderer.on(AUTH_IPC.STATE_CHANGED, handler)
    return () => ipcRenderer.removeListener(AUTH_IPC.STATE_CHANGED, handler)
  },
}

export type AuthBridge = VoiceAuthBridge
