import { useEffect, useState } from 'react'
import { m } from 'framer-motion'
import { CircularWaveform } from './CircularWaveform'
import { useEnrollmentCapture } from '../../hooks/useVoiceAuth'
import { useAuthStore } from '../../stores/authStore'
import { useAdaptivePerformance } from '../../hooks/useAdaptivePerformance'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useTheme } from '../../theme/useTheme'
import {
  ENROLL_SAMPLES_REQUIRED,
  type EnrollSampleResult,
  type SampleRejection,
} from '../../../../shared/auth-types'

/**
 * Voiceprint enrolment.
 *
 * Three takes of the same phrase, then a mandatory recovery passphrase. The
 * passphrase step is not skippable and is not framed as optional — a user who
 * skips it and later changes microphones, catches a cold, or moves machines is
 * locked out of their own assistant with no recourse.
 *
 * Must be rendered inside the LockScreen's <LazyMotion>.
 */

const SUGGESTED_PHRASE = 'The mind sees what the eye cannot'

const REJECTION_COPY: Record<SampleRejection, string> = {
  'too-short': 'Too short — say the whole phrase.',
  'too-long': 'Too long — keep it under about eight seconds.',
  'too-quiet': 'Too quiet or too much background noise.',
  clipped: 'Too loud — move back from the microphone.',
  'no-speech': "Didn't hear anything.",
  inconsistent: 'That sounded like a different phrase — say the same one each time.',
}

type Step = 'intro' | 'recording' | 'passphrase' | 'done'

export function EnrollmentFlow({ onClose }: { onClose: () => void }): JSX.Element {
  const { theme } = useTheme()
  const t = theme.tokens
  const perf = useAdaptivePerformance(true)
  const reducedMotion = useReducedMotion()
  const hydrate = useAuthStore((s) => s.hydrate)

  const { analyserRef, recording, recordSample, abort } = useEnrollmentCapture()

  const [step, setStep] = useState<Step>('intro')
  const [collected, setCollected] = useState(0)
  const [note, setNote] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => {
      abort()
      // Drop any half-finished enrolment in main so a later attempt starts clean.
      void window.reigan?.auth.enrollCancel()
    }
  }, [abort])

  const begin = async (): Promise<void> => {
    setError(null)
    await window.reigan.auth.enrollBegin()
    setCollected(0)
    setStep('recording')
  }

  const takeSample = async (): Promise<void> => {
    setNote(null)
    const result: EnrollSampleResult | null = await recordSample()
    if (!result) {
      setNote('Recording failed — check the microphone.')
      return
    }
    if (!result.accepted) {
      setNote(result.rejection ? REJECTION_COPY[result.rejection] : 'Try again.')
      return
    }
    setCollected(result.collected)
    if (result.collected >= result.required) setStep('passphrase')
  }

  const commit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    if (passphrase.length < 8) {
      setError('Passphrase must be at least 8 characters.')
      return
    }
    if (passphrase !== confirm) {
      setError('Passphrases do not match.')
      return
    }
    setBusy(true)
    const result = await window.reigan.auth.enrollCommit(passphrase)
    setBusy(false)
    if (!result.ok) {
      setError(result.error ?? 'Enrolment failed.')
      return
    }
    setPassphrase('')
    setConfirm('')
    await hydrate()
    setStep('done')
  }

  const label: React.CSSProperties = {
    fontFamily: t.type.mono,
    fontSize: t.type.scale.xs,
    letterSpacing: t.type.tracking.wide,
    color: t.text.muted,
    textTransform: 'uppercase',
  }
  const body: React.CSSProperties = {
    fontFamily: t.type.body,
    fontSize: t.type.scale.sm,
    color: t.text.secondary,
  }
  const input: React.CSSProperties = {
    fontFamily: t.type.mono,
    fontSize: t.type.scale.sm,
    backgroundColor: t.surface.sunken,
    color: t.text.primary,
    border: `1px solid ${t.border.subtle}`,
    borderRadius: t.radius.sm,
  }
  const primary: React.CSSProperties = {
    fontFamily: t.type.display,
    fontSize: t.type.scale.sm,
    letterSpacing: t.type.tracking.wide,
    backgroundColor: t.accent.primary,
    color: t.text.inverse,
    borderRadius: t.radius.sm,
  }

  return (
    <m.div
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative flex flex-col items-center gap-6 px-10 py-10 w-[30rem]"
      style={{
        backdropFilter: `blur(${t.surface.glassBlur})`,
        WebkitBackdropFilter: `blur(${t.surface.glassBlur})`,
        backgroundColor: t.surface.glassTint,
        border: `1px solid ${t.border.subtle}`,
        borderRadius: t.radius.lg,
      }}
    >
      <span style={label}>Voice enrolment</span>

      {step === 'intro' && (
        <>
          <p style={{ ...body, textAlign: 'center' }}>
            You&apos;ll say one phrase {ENROLL_SAMPLES_REQUIRED} times. Pick something you can
            repeat the same way every time, and record where you normally sit.
          </p>
          <div
            className="px-4 py-3 w-full text-center"
            style={{
              fontFamily: t.type.mono,
              fontSize: t.type.scale.md,
              color: t.text.accent,
              backgroundColor: t.surface.sunken,
              borderRadius: t.radius.sm,
            }}
          >
            {SUGGESTED_PHRASE}
          </div>
          <p style={{ ...body, fontSize: t.type.scale.xs, textAlign: 'center', color: t.text.muted }}>
            Voice unlock is a convenience, not a vault. A recording of your voice can defeat it —
            the recovery passphrase you set at the end is the real credential.
          </p>
          <div className="flex gap-3 w-full">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2"
              style={{ ...body, border: `1px solid ${t.border.subtle}`, borderRadius: t.radius.sm }}
            >
              Cancel
            </button>
            <button type="button" onClick={begin} className="flex-1 py-2" style={primary}>
              BEGIN
            </button>
          </div>
        </>
      )}

      {step === 'recording' && (
        <>
          <div className="relative flex items-center justify-center" style={{ width: 180, height: 180 }}>
            <CircularWaveform
              analyserRef={analyserRef}
              active={recording}
              tier={perf.tier}
              suspended={perf.suspended}
              size={180}
            />
            <div
              className="rounded-full"
              style={{
                width: 56,
                height: 56,
                background: `radial-gradient(circle at 38% 32%, ${t.accent.secondary}, ${t.accent.primary})`,
                opacity: recording ? 1 : 0.5,
                transition: `opacity ${t.motion.durationBase} ${t.motion.easeStandard}`,
              }}
            />
          </div>

          <div className="flex gap-2">
            {Array.from({ length: ENROLL_SAMPLES_REQUIRED }, (_, i) => (
              <span
                key={i}
                style={{
                  width: 34,
                  height: 3,
                  borderRadius: t.radius.pill,
                  backgroundColor: i < collected ? t.accent.secondary : t.border.strong,
                  transition: `background-color ${t.motion.durationBase} ${t.motion.easeStandard}`,
                }}
              />
            ))}
          </div>

          <p style={{ ...body, textAlign: 'center', minHeight: '2.5rem' }}>
            {recording
              ? 'Listening — say the phrase now.'
              : (note ?? `Take ${collected + 1} of ${ENROLL_SAMPLES_REQUIRED}. Press record, then speak.`)}
          </p>

          <div className="flex gap-3 w-full">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2"
              style={{ ...body, border: `1px solid ${t.border.subtle}`, borderRadius: t.radius.sm }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={takeSample}
              disabled={recording}
              className="flex-1 py-2 disabled:opacity-40"
              style={primary}
            >
              {recording ? 'RECORDING…' : 'RECORD'}
            </button>
          </div>
        </>
      )}

      {step === 'passphrase' && (
        <form onSubmit={commit} className="flex flex-col gap-3 w-full">
          <p style={{ ...body, textAlign: 'center' }}>
            Set a recovery passphrase. This is how you get in when voice fails — a new microphone,
            a sore throat, a different machine.
          </p>
          <input
            type="password"
            autoFocus
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Recovery passphrase"
            className="px-3 py-2 outline-none"
            style={input}
          />
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Confirm passphrase"
            className="px-3 py-2 outline-none"
            style={input}
          />
          {error && (
            <span style={{ ...body, color: t.accent.danger, fontSize: t.type.scale.xs }}>{error}</span>
          )}
          <button type="submit" disabled={busy} className="py-2 disabled:opacity-40" style={primary}>
            {busy ? 'SAVING…' : 'FINISH'}
          </button>
        </form>
      )}

      {step === 'done' && (
        <>
          <p style={{ ...body, textAlign: 'center' }}>
            Voiceprint stored and encrypted on this device. Lock the app to try it.
          </p>
          <button type="button" onClick={onClose} className="w-full py-2" style={primary}>
            DONE
          </button>
        </>
      )}
    </m.div>
  )
}
