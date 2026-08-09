import { create } from 'zustand'
import type {
  AuthFailureReason,
  AuthPhase,
  AuthStatus,
  LivenessChallenge,
} from '../../../shared/auth-types'

/**
 * Renderer-side mirror of the auth state.
 *
 * "Mirror" is the operative word: main is authoritative about whether the app
 * is locked, and this store only caches what main last told us so the UI can
 * render without awaiting a round trip. Never treat `status.locked === false`
 * here as permission to do anything sensitive — that decision belongs to a
 * guarded handler in main.
 *
 * `phase` is different: it is purely local animation state, owned entirely by
 * the renderer, and is what the lock screen's transitions key off.
 */

/** Failure copy. Deliberately vague about *why* a voice attempt failed. */
const FAILURE_MESSAGES: Record<AuthFailureReason, string> = {
  'not-enrolled': 'No voiceprint enrolled on this device.',
  cooldown: 'Too many attempts. Wait for the cooldown to clear.',
  'no-speech': "Didn't catch that — speak clearly after the tone.",
  'too-short': 'Too short. Say the full passphrase.',
  // Same wording as no-match on purpose: telling an attacker that the
  // biometric passed but liveness failed tells them the recording works and
  // only the challenge needs solving.
  'liveness-failed': 'Not recognised.',
  'no-match': 'Not recognised.',
  'voiceprint-unreadable': 'Voiceprint could not be read on this machine. Use your passphrase.',
  internal: 'Something went wrong. Use your passphrase.',
}

export function failureMessage(reason: AuthFailureReason | undefined): string {
  return reason ? FAILURE_MESSAGES[reason] : FAILURE_MESSAGES.internal
}

interface AuthStore {
  status: AuthStatus | null
  phase: AuthPhase
  challenge: LivenessChallenge | null
  /** User-facing line under the orb. Null when there is nothing to say. */
  message: string | null
  sessionExpiresAt: number
  /** True while the enrolment flow is open over the lock screen. */
  enrolling: boolean

  setStatus: (status: AuthStatus) => void
  setPhase: (phase: AuthPhase) => void
  setChallenge: (challenge: LivenessChallenge | null) => void
  setMessage: (message: string | null) => void
  setSessionExpiry: (at: number) => void
  setEnrolling: (enrolling: boolean) => void
  hydrate: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  status: null,
  phase: 'idle',
  challenge: null,
  message: null,
  sessionExpiresAt: 0,
  enrolling: false,

  setStatus: (status) =>
    set((s) => ({
      status,
      // A cooldown arriving from main outranks whatever the UI was doing —
      // otherwise the orb keeps offering to listen while main refuses.
      phase: status.cooldownUntil > Date.now() ? 'cooldown' : s.phase,
    })),
  setPhase: (phase) => set({ phase }),
  setChallenge: (challenge) => set({ challenge }),
  setMessage: (message) => set({ message }),
  setSessionExpiry: (sessionExpiresAt) => set({ sessionExpiresAt }),
  setEnrolling: (enrolling) => set({ enrolling }),

  hydrate: async () => {
    const status = await window.reigan?.auth.status()
    if (status) set({ status })
  },
}))
