/**
 * Voice-authentication contract shared by main, preload and renderer.
 *
 * Threat model, stated up front because it shapes every type below:
 *
 * Voice is treated as a *convenience* factor, not a strong biometric. A
 * recording of the enrolled passphrase played back into the microphone will
 * pass speaker comparison — that is true of every consumer voice-unlock
 * system, and the liveness challenge here only raises the cost, it does not
 * remove the attack. Consequently:
 *
 *   - A passphrase (typed) fallback is mandatory at enrolment. It is the
 *     real credential; voice is the fast path. Never ship a build where the
 *     only way in is the microphone.
 *   - The lock protects against a *casual* observer at an unattended desk.
 *     It is not a disk-encryption boundary: anything the main process can
 *     read while locked (the SQLite file, the OS keychain entry) is still
 *     readable by anyone with the OS account. Lock ≠ at-rest protection for
 *     the rest of the app's data.
 *   - Scores are never returned to the renderer on failure. Feeding a
 *     similarity number back to a caller who can retry lets an attacker
 *     hill-climb towards the threshold.
 */

// ── Channels ──
// Kept separate from IPC in shared/types.ts so the auth surface is auditable
// in one place; every channel below is invoke/handle except the two marked.
export const AUTH_IPC = {
  STATUS: 'auth:status',
  ENROLL_BEGIN: 'auth:enroll-begin',
  ENROLL_SAMPLE: 'auth:enroll-sample',
  ENROLL_COMMIT: 'auth:enroll-commit',
  ENROLL_CANCEL: 'auth:enroll-cancel',
  RESET: 'auth:reset',
  CHALLENGE: 'auth:challenge',
  VERIFY: 'auth:verify',
  VERIFY_FALLBACK: 'auth:verify-fallback',
  LOCK: 'auth:lock',
  SET_IDLE_TIMEOUT: 'auth:set-idle-timeout',
  ACTIVITY: 'auth:activity', // send (fire-and-forget, debounced by renderer)
  STATE_CHANGED: 'auth:state-changed', // main → renderer broadcast
} as const

// ── Status ──

/** Where the master key actually lives. Surfaced so the UI can warn honestly. */
export type KeyBackend = 'os-keychain' | 'device-file'

export interface AuthStatus {
  enrolled: boolean
  locked: boolean
  /** Epoch ms when the rate-limit cooldown expires; 0 when not cooling down. */
  cooldownUntil: number
  /** Attempts left before the next cooldown tier. */
  attemptsRemaining: number
  /** Idle milliseconds before auto-lock; 0 disables auto-lock. */
  idleTimeoutMs: number
  keyBackend: KeyBackend
  /** True when the voiceprint could not be decrypted — usually a machine change. */
  voiceprintUnreadable: boolean
}

// ── Audio payload ──

/**
 * Raw mono PCM as it leaves the renderer. Float32 in [-1, 1]; transferred as
 * an ArrayBuffer so it crosses the bridge as a copy, not a live view.
 * Never persisted — main extracts features and drops the samples.
 */
export interface AudioPayload {
  pcm: ArrayBuffer
  sampleRate: number
}

// ── Enrolment ──

/** How many utterances enrolment needs before a threshold can be calibrated. */
export const ENROLL_SAMPLES_REQUIRED = 3

export interface SampleQuality {
  durationMs: number
  /** Crude frame-energy SNR estimate, dB. Below ~10 the sample is rejected. */
  snrDb: number
  clipped: boolean
  /** Frames that passed voice-activity detection. */
  speechFrames: number
}

export type SampleRejection =
  | 'too-short'
  | 'too-long'
  | 'too-quiet'
  | 'clipped'
  | 'no-speech'
  | 'inconsistent' // did not match the earlier samples of this enrolment

export interface EnrollSampleResult {
  accepted: boolean
  rejection?: SampleRejection
  /** Samples banked so far. */
  collected: number
  required: number
  quality: SampleQuality
}

export interface EnrollCommitResult {
  ok: boolean
  error?: string
  /** Calibrated decision threshold, shown in settings as a consistency read-out. */
  threshold?: number
  /** Mean self-similarity across enrolment samples — how repeatable the user is. */
  consistency?: number
}

// ── Liveness ──

/**
 * A short random digit string the user must append to the passphrase. Bound to
 * a single verify call and expires quickly, so a plain recording of the
 * passphrase alone fails the length/novelty check.
 *
 * Honest limitation: without offline ASR we cannot confirm *which* digits were
 * spoken, only that a novel segment of roughly the right length followed the
 * passphrase. See ChallengeVerdict.
 */
export interface LivenessChallenge {
  id: string
  digits: string
  expiresAt: number
}

export type ChallengeVerdict = 'passed' | 'no-suffix' | 'wrong-length' | 'expired'

// ── Verification ──

export type AuthFailureReason =
  | 'not-enrolled'
  | 'cooldown'
  | 'no-speech'
  | 'too-short'
  | 'liveness-failed'
  | 'no-match'
  | 'voiceprint-unreadable'
  | 'internal'

export interface VerifyResult {
  ok: boolean
  reason?: AuthFailureReason
  cooldownUntil?: number
  attemptsRemaining?: number
  /** Epoch ms. Present only on success. */
  sessionExpiresAt?: number
}

// ── Session ──

export type LockReason = 'manual' | 'idle' | 'startup' | 'enrollment-reset'

export interface AuthStateEvent {
  status: AuthStatus
  /** Why main pushed this event — lets the UI pick the right transition. */
  cause: 'unlocked' | 'locked' | 'enrolled' | 'reset' | 'cooldown-changed'
  lockReason?: LockReason
}

// ── Renderer-side UI phases ──

/**
 * Drives the lock screen's animation state machine. Distinct from AuthStatus:
 * main owns *whether* the app is locked, the renderer owns *what the orb is
 * doing right now*.
 */
export type AuthPhase =
  | 'idle' // locked, breathing
  | 'listening' // capturing
  | 'processing' // main is scoring
  | 'unlocking' // success, reveal running
  | 'failed' // shake + red glow
  | 'cooldown' // rate-limited

// ── Bridge shape ──

/**
 * The contract `window.reigan.auth` satisfies.
 *
 * Declared here rather than inferred from the preload module so the renderer
 * never has to import across the process boundary — src/preload is not in the
 * web tsconfig, and pulling it in would drag Electron's main-process types
 * into the browser build.
 */
export interface VoiceAuthBridge {
  status(): Promise<AuthStatus>
  enrollBegin(): Promise<{ ok: boolean }>
  enrollSample(pcm: ArrayBuffer, sampleRate: number): Promise<EnrollSampleResult>
  enrollCommit(fallbackPassphrase: string): Promise<EnrollCommitResult>
  enrollCancel(): Promise<{ ok: boolean }>
  reset(): Promise<{ ok: boolean }>
  challenge(): Promise<LivenessChallenge>
  verify(pcm: ArrayBuffer, sampleRate: number, challengeId?: string): Promise<VerifyResult>
  verifyPassphrase(passphrase: string): Promise<VerifyResult>
  lock(): Promise<{ ok: boolean }>
  setIdleTimeout(ms: number): Promise<{ ok: boolean }>
  ping(): void
  onStateChanged(callback: (event: AuthStateEvent) => void): () => void
}

// ── Tunables ──

export const AUTH_DEFAULTS = {
  /** Utterance bounds. Shorter than this carries too little speaker signal. */
  minUtteranceMs: 900,
  maxUtteranceMs: 8000,
  /** Consecutive failures before a cooldown tier engages. */
  maxAttempts: 3,
  /** Cooldown ladder in ms; the last entry repeats. */
  cooldownLadderMs: [30_000, 120_000, 600_000, 1_800_000],
  /** Auto-lock idle timeout. */
  idleTimeoutMs: 10 * 60_000,
  /** Session lifetime cap regardless of activity. 0 = no cap. */
  sessionMaxMs: 12 * 60 * 60_000,
  challengeTtlMs: 45_000,
  /** Digits in the liveness challenge. */
  challengeDigits: 4,
} as const
