/**
 * Voice authentication orchestration — the only module the IPC layer talks to.
 *
 * Order of checks in verify() is deliberate and should not be rearranged:
 * rate limit first (so a throttled attacker never reaches the expensive DSP
 * path), then audio validity, then liveness, then the biometric comparison.
 * Cheap and abuse-resistant before expensive and informative.
 */

import { randomBytes, randomInt } from 'crypto'
import {
  AUTH_DEFAULTS,
  ENROLL_SAMPLES_REQUIRED,
  type AuthStatus,
  type EnrollCommitResult,
  type EnrollSampleResult,
  type LivenessChallenge,
  type SampleQuality,
  type VerifyResult,
} from '../../shared/auth-types'
import { extractFeatures, HOP_LEN, SAMPLE_RATE, type FeatureFrames } from './dsp'
import {
  calibrate,
  deserialiseTemplate,
  match,
  pairScore,
  serialiseTemplate,
  type VoiceTemplate,
} from './embedding'
import {
  decryptRecord,
  deleteAuthState,
  encryptRecord,
  hasFallbackPassphrase,
  keyBackend,
  purgeSecrets,
  readAuthState,
  setFallbackPassphrase,
  verifyFallbackPassphrase,
  writeAuthState,
} from './crypto'
import * as rateLimit from './rateLimit'
import * as session from './session'

const VOICEPRINT_ROW = 'voiceprint'
const IDLE_TIMEOUT_ROW = 'idle_timeout_ms'

const FRAME_MS = (HOP_LEN / SAMPLE_RATE) * 1000 // 10

/** Rough spoken length of one digit, used for the liveness suffix length check. */
const MS_PER_DIGIT = 420
/** A suffix shorter than this is treated as absent rather than short. */
const SUFFIX_MIN_MS = 260
/** Minimum acceptable SNR for an enrolment sample. */
const MIN_ENROLL_SNR_DB = 9
/** An enrolment sample must agree with the earlier ones by at least this much. */
const ENROLL_CONSISTENCY_FLOOR = 0.5

let cachedTemplate: VoiceTemplate | null = null
let templateLoadFailed = false

// ── Template persistence ──

function loadTemplate(): VoiceTemplate | null {
  if (cachedTemplate) return cachedTemplate
  const blob = readAuthState(VOICEPRINT_ROW)
  if (!blob) {
    templateLoadFailed = false
    return null
  }
  const json = decryptRecord(VOICEPRINT_ROW, blob)
  if (!json) {
    // Row present but undecryptable — key rotated, machine changed, or tampering.
    templateLoadFailed = true
    return null
  }
  cachedTemplate = deserialiseTemplate(json)
  templateLoadFailed = cachedTemplate === null
  return cachedTemplate
}

function storeTemplate(template: VoiceTemplate): void {
  writeAuthState(VOICEPRINT_ROW, encryptRecord(VOICEPRINT_ROW, serialiseTemplate(template)))
  cachedTemplate = template
  templateLoadFailed = false
}

// ── Status ──

export function getStatus(): AuthStatus {
  const enrolled = readAuthState(VOICEPRINT_ROW) !== null
  if (enrolled) loadTemplate() // populates templateLoadFailed
  const verdict = rateLimit.check()

  return {
    enrolled,
    // Only an enrolled device can be locked. Reporting `locked` for a user who
    // has never enrolled would wall them out of their own app with no
    // credential that could possibly open it.
    locked: enrolled && !session.isUnlocked(),
    cooldownUntil: verdict.cooldownUntil,
    attemptsRemaining: verdict.attemptsRemaining,
    idleTimeoutMs: session.getIdleTimeout(),
    keyBackend: keyBackend(),
    voiceprintUnreadable: enrolled && templateLoadFailed,
  }
}

/**
 * Called once at startup. Restores the configured idle timeout and starts
 * locked — but only if there is actually a voiceprint to unlock with.
 */
export function initialise(): void {
  const stored = readAuthState(IDLE_TIMEOUT_ROW)
  session.setIdleTimeout(stored !== null ? Number(stored) : AUTH_DEFAULTS.idleTimeoutMs)
  if (readAuthState(VOICEPRINT_ROW) !== null) session.lock('startup')
}

export function setIdleTimeout(ms: number): void {
  writeAuthState(IDLE_TIMEOUT_ROW, String(ms))
  session.setIdleTimeout(ms)
}

// ── Audio decoding ──

function toFloat32(payload: ArrayBuffer): Float32Array {
  // The bridge hands us a copied ArrayBuffer; wrap without copying again.
  return new Float32Array(payload)
}

function emptyQuality(): SampleQuality {
  return { durationMs: 0, snrDb: 0, clipped: false, speechFrames: 0 }
}

// ── Enrolment ──

interface EnrollSession {
  /** Whole feature objects — the speaker view is needed at calibrate() time. */
  samples: FeatureFrames[]
  startedAt: number
}

let enrollment: EnrollSession | null = null

export function beginEnrollment(): void {
  enrollment = { samples: [], startedAt: Date.now() }
}

export function cancelEnrollment(): void {
  enrollment = null
}

export function addEnrollmentSample(pcm: ArrayBuffer, sampleRate: number): EnrollSampleResult {
  if (!enrollment) beginEnrollment()
  const active = enrollment!

  const reject = (
    rejection: EnrollSampleResult['rejection'],
    quality: SampleQuality
  ): EnrollSampleResult => ({
    accepted: false,
    rejection,
    collected: active.samples.length,
    required: ENROLL_SAMPLES_REQUIRED,
    quality,
  })

  const features = extractFeatures(toFloat32(pcm), sampleRate)
  if (!features) return reject('no-speech', emptyQuality())

  const { quality } = features
  const speechMs = features.frames.length * FRAME_MS

  if (quality.clipped) return reject('clipped', quality)
  if (speechMs < AUTH_DEFAULTS.minUtteranceMs) return reject('too-short', quality)
  if (speechMs > AUTH_DEFAULTS.maxUtteranceMs) return reject('too-long', quality)
  if (quality.snrDb < MIN_ENROLL_SNR_DB) return reject('too-quiet', quality)

  // Guard against enrolling three different phrases: every sample after the
  // first must resemble the first, or the calibrated threshold is meaningless.
  if (active.samples.length > 0) {
    const agreement = pairScore(active.samples[0], features)
    if (agreement < ENROLL_CONSISTENCY_FLOOR) return reject('inconsistent', quality)
  }

  active.samples.push(features)
  return {
    accepted: true,
    collected: active.samples.length,
    required: ENROLL_SAMPLES_REQUIRED,
    quality,
  }
}

/**
 * Finalises enrolment. The fallback passphrase is required, not optional —
 * see the threat-model note in shared/auth-types.ts. Without it a failed
 * microphone locks the user out of their own assistant permanently.
 */
export function commitEnrollment(fallbackPassphrase: string): EnrollCommitResult {
  if (!enrollment || enrollment.samples.length < ENROLL_SAMPLES_REQUIRED) {
    return { ok: false, error: `Need ${ENROLL_SAMPLES_REQUIRED} accepted samples.` }
  }
  if (!fallbackPassphrase || fallbackPassphrase.length < 8) {
    return { ok: false, error: 'Fallback passphrase must be at least 8 characters.' }
  }

  try {
    const template = calibrate(enrollment.samples)
    storeTemplate(template)
    setFallbackPassphrase(fallbackPassphrase)
    rateLimit.reset()
    enrollment = null
    return { ok: true, threshold: template.threshold, consistency: template.consistency }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Enrolment failed.' }
  }
}

/** Clears the voiceprint, the fallback credential and the derived key material. */
export function resetEnrollment(): void {
  deleteAuthState(VOICEPRINT_ROW)
  purgeSecrets()
  rateLimit.reset()
  cachedTemplate = null
  templateLoadFailed = false
  enrollment = null
  session.lock('enrollment-reset')
}

// ── Liveness challenge ──

let activeChallenge: (LivenessChallenge & { consumed: boolean }) | null = null

export function issueChallenge(): LivenessChallenge {
  let digits = ''
  for (let i = 0; i < AUTH_DEFAULTS.challengeDigits; i++) digits += randomInt(0, 10).toString()

  activeChallenge = {
    id: randomBytes(9).toString('base64url'),
    digits,
    expiresAt: Date.now() + AUTH_DEFAULTS.challengeTtlMs,
    consumed: false,
  }
  return { id: activeChallenge.id, digits: activeChallenge.digits, expiresAt: activeChallenge.expiresAt }
}

/**
 * Checks that a novel segment of roughly the right length followed the enrolled
 * phrase.
 *
 * This is the honest limit of offline liveness without an ASR model: we can
 * see *that* the speaker said something extra after the passphrase, and that it
 * lasted about as long as four digits should, but not *which* digits. It
 * defeats a plain recording of the passphrase — the common attack — and does
 * not defeat an attacker who has recorded the user saying every digit and can
 * splice on demand. Wiring an offline recogniser (whisper.cpp, Vosk) into this
 * function is the upgrade path; nothing else has to change.
 */
function checkLiveness(
  challengeId: string | undefined,
  phraseEndFrame: number,
  trialFrames: number
): 'passed' | 'expired' | 'no-suffix' | 'wrong-length' {
  if (!activeChallenge) return 'expired'
  if (challengeId !== activeChallenge.id) return 'expired'
  if (activeChallenge.consumed) return 'expired'
  if (Date.now() > activeChallenge.expiresAt) return 'expired'

  activeChallenge.consumed = true

  const suffixMs = Math.max(0, trialFrames - phraseEndFrame) * FRAME_MS
  if (suffixMs < SUFFIX_MIN_MS) return 'no-suffix'

  const expected = activeChallenge.digits.length * MS_PER_DIGIT
  // Generous band — speaking rate varies enormously, and a false rejection here
  // is indistinguishable to the user from the biometric failing.
  const tolerance = expected * 0.65 + 300
  if (Math.abs(suffixMs - expected) > tolerance) return 'wrong-length'

  return 'passed'
}

// ── Verification ──

function fail(reason: VerifyResult['reason']): VerifyResult {
  const verdict = rateLimit.recordFailure()
  return {
    ok: false,
    reason,
    cooldownUntil: verdict.cooldownUntil,
    attemptsRemaining: verdict.attemptsRemaining,
  }
}

/**
 * Scores an utterance and, on success, opens a session.
 *
 * Note what is *not* returned: the similarity score. Handing a number back to
 * a caller that can retry turns the lock into a hill-climbing oracle — an
 * attacker tweaks their impression, watches the score rise, and converges.
 * Callers get pass/fail and a reason category, nothing finer.
 */
export function verify(
  pcm: ArrayBuffer,
  sampleRate: number,
  challengeId?: string
): VerifyResult {
  const gate = rateLimit.check()
  if (!gate.allowed) {
    return {
      ok: false,
      reason: 'cooldown',
      cooldownUntil: gate.cooldownUntil,
      attemptsRemaining: 0,
    }
  }

  const template = loadTemplate()
  if (!template) {
    return {
      ok: false,
      reason: templateLoadFailed ? 'voiceprint-unreadable' : 'not-enrolled',
    }
  }

  const features = extractFeatures(toFloat32(pcm), sampleRate)
  if (!features) return fail('no-speech')

  const speechMs = features.frames.length * FRAME_MS
  if (speechMs < AUTH_DEFAULTS.minUtteranceMs) return fail('too-short')

  const result = match(template, features)

  // Liveness is checked before the score so a replayed passphrase is rejected
  // as a spoof rather than quietly accepted on biometric strength alone.
  if (challengeId) {
    const verdict = checkLiveness(challengeId, result.phraseEndFrame, result.trialFrames)
    if (verdict !== 'passed') return fail('liveness-failed')
  }

  if (result.combined < template.threshold) return fail('no-match')

  rateLimit.recordSuccess()
  const opened = session.unlock()
  return { ok: true, sessionExpiresAt: opened.expiresAt }
}

/** The always-available way in. Rate limited on the same ladder as voice. */
export function verifyPassphrase(passphrase: string): VerifyResult {
  const gate = rateLimit.check()
  if (!gate.allowed) {
    return { ok: false, reason: 'cooldown', cooldownUntil: gate.cooldownUntil, attemptsRemaining: 0 }
  }
  if (!hasFallbackPassphrase()) return { ok: false, reason: 'not-enrolled' }
  if (!verifyFallbackPassphrase(passphrase)) return fail('no-match')

  rateLimit.recordSuccess()
  const opened = session.unlock()
  return { ok: true, sessionExpiresAt: opened.expiresAt }
}

// ── Session passthrough ──

export const lock = session.lock
export const touch = session.touch
export const isUnlocked = session.isUnlocked
export const requireUnlocked = session.requireUnlocked
export const setLockListener = session.setLockListener
