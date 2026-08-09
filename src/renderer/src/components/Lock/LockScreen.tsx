import { useEffect, useMemo, useState } from 'react'
import { m } from 'framer-motion'
import { AuthOrb } from './AuthOrb'
import { EnrollmentFlow } from './EnrollmentFlow'
import { useAuthStore } from '../../stores/authStore'
import { useVoiceAuth } from '../../hooks/useVoiceAuth'
import { useAdaptivePerformance } from '../../hooks/useAdaptivePerformance'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useTheme } from '../../theme/useTheme'
import { UNLOCK_SECONDS } from './timing'
import { APP_NAME, APP_NAME_JP } from '../../../../shared/constants'

/**
 * The lock screen.
 *
 * Animation budget is deliberate. Only three things ever animate at once —
 * the orb, one background gradient layer, and (on success) a single sweep
 * element — and every one of them animates transform or opacity only, so the
 * whole screen composites on the GPU without a layout or paint pass.
 *
 * The <LazyMotion> provider lives in LockGate, not here — it has to outlive
 * this component's exit animation. `domAnimation` rather than `domMax`: it is
 * roughly half the size and covers everything used here. Nothing on this
 * screen needs layout projection or drag.
 *
 * Surfaces read glass tokens rather than hard-coding a blur, so the panel is
 * frosted under themes that define a blur and cleanly flat under Shingan,
 * which deliberately sets glassBlur to 0.
 */

export function LockScreen(): JSX.Element {
  const { theme } = useTheme()
  const t = theme.tokens
  const reducedMotion = useReducedMotion()
  const perf = useAdaptivePerformance(true)

  const status = useAuthStore((s) => s.status)
  const challenge = useAuthStore((s) => s.challenge)
  const enrolling = useAuthStore((s) => s.enrolling)
  const setEnrolling = useAuthStore((s) => s.setEnrolling)

  const { phase, message, analyserRef, startUnlock, cancel, unlockWithPassphrase } = useVoiceAuth()

  const [showPassphrase, setShowPassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [now, setNow] = useState(Date.now())

  const cooldownUntil = status?.cooldownUntil ?? 0
  const cooling = cooldownUntil > now
  const enrolled = status?.enrolled ?? false

  // One interval, and only while a cooldown is actually counting down.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [cooldownUntil])

  // Escape backs out of an in-flight attempt rather than trapping the user
  // in a listening state they cannot leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (phase === 'listening' || phase === 'processing')) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, cancel])

  const remaining = useMemo(() => {
    const secs = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }, [cooldownUntil, now])

  const heavyEffects = perf.tier === 'high' && !reducedMotion && !perf.suspended
  const unlocking = phase === 'unlocking'

  const submitPassphrase = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!passphrase) return
    const ok = await unlockWithPassphrase(passphrase)
    setPassphrase('')
    if (ok) setShowPassphrase(false)
  }

  return (
    <m.div
        className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden"
        style={{ backgroundColor: t.surface.base }}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0 }}
        animate={{ opacity: 1 }}
        // The reveal: the whole lock plate scales up and fades, uncovering the
        // shell that is already mounted underneath. One transform, one opacity.
        exit={
          reducedMotion
            ? { opacity: 0, transition: { duration: UNLOCK_SECONDS.reducedFade } }
            : {
                opacity: 0,
                scale: 1.14,
                // No blur here on purpose: animating `filter` on a full-screen
                // layer forces a repaint every frame and is exactly what tanks
                // integrated GPUs. Scale plus opacity reads the same and stays
                // on the compositor.
                transition: { duration: UNLOCK_SECONDS.reveal, ease: [0.16, 1, 0.3, 1] },
              }
        }
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Ambient background. Transform-only animation on a single layer. */}
        {perf.tier !== 'low' && !perf.suspended && (
          <m.div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{
              background: `radial-gradient(60% 50% at 50% 42%, ${t.accent.primary}22 0%, transparent 70%)`,
              willChange: reducedMotion ? undefined : 'transform',
            }}
            animate={
              reducedMotion
                ? undefined
                : { scale: [1, 1.12, 1], opacity: [0.55, 0.85, 0.55] }
            }
            transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}

        {/* Static grid — pure CSS, no animation, matches the app's chrome. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 pointer-events-none"
          style={{
            backgroundImage: `linear-gradient(${t.border.subtle} 1px, transparent 1px), linear-gradient(90deg, ${t.border.subtle} 1px, transparent 1px)`,
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(circle at 50% 45%, black 0%, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(circle at 50% 45%, black 0%, transparent 75%)',
            opacity: 0.5,
          }}
        />

        {/* Scan-line sweep on success. Transform only, high tier only. */}
        {unlocking && heavyEffects && (
          <m.div
            aria-hidden="true"
            className="absolute inset-x-0 pointer-events-none"
            style={{
              height: '28%',
              background: `linear-gradient(to bottom, transparent, ${t.accent.secondary}26, transparent)`,
              willChange: 'transform',
            }}
            initial={{ y: '-30%' }}
            animate={{ y: '130%' }}
            transition={{ duration: UNLOCK_SECONDS.scanline, ease: 'easeOut' }}
          />
        )}

        {enrolling ? (
          <EnrollmentFlow onClose={() => setEnrolling(false)} />
        ) : (
          <div
            className="relative flex flex-col items-center gap-7 px-10 py-12 rounded-2xl"
            style={{
              // Glass tokens, not a hard-coded blur — flat under Shingan,
              // frosted under any theme that opts in.
              backdropFilter: `blur(${t.surface.glassBlur})`,
              WebkitBackdropFilter: `blur(${t.surface.glassBlur})`,
              backgroundColor: t.surface.glassTint,
              border: `1px solid ${t.border.subtle}`,
              borderRadius: t.radius.lg,
            }}
          >
            <Wordmark unlocking={unlocking} heavyEffects={heavyEffects} />

            <AuthOrb
              phase={phase}
              analyserRef={analyserRef}
              tier={perf.tier}
              reducedMotion={reducedMotion}
              suspended={perf.suspended}
              onActivate={enrolled ? startUnlock : () => setEnrolling(true)}
              disabled={cooling || phase === 'processing' || unlocking}
            />

            {/* Liveness challenge. Monospace, per the type scale. */}
            <div className="h-14 flex flex-col items-center justify-center gap-1">
              {phase === 'listening' && challenge && (
                <m.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center gap-1"
                >
                  <span
                    className="uppercase"
                    style={{
                      fontFamily: t.type.mono,
                      fontSize: t.type.scale.xs,
                      letterSpacing: t.type.tracking.wide,
                      color: t.text.muted,
                    }}
                  >
                    Passphrase, then
                  </span>
                  <span
                    style={{
                      fontFamily: t.type.mono,
                      fontSize: t.type.scale.xl,
                      letterSpacing: '0.34em',
                      color: t.accent.secondary,
                    }}
                  >
                    {challenge.digits}
                  </span>
                </m.div>
              )}

              {phase !== 'listening' && (
                <span
                  style={{
                    fontFamily: t.type.body,
                    fontSize: t.type.scale.sm,
                    color: phase === 'failed' ? t.accent.danger : t.text.secondary,
                  }}
                >
                  {statusLine({ phase, message, cooling, remaining, enrolled })}
                </span>
              )}
            </div>

            {/* Fallback. Always reachable — see the threat-model note in auth-types. */}
            {enrolled && (
              <div className="w-full flex flex-col items-center gap-3">
                {showPassphrase ? (
                  <form onSubmit={submitPassphrase} className="flex flex-col items-center gap-2 w-72">
                    <input
                      type="password"
                      autoFocus
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Recovery passphrase"
                      className="w-full px-3 py-2 rounded outline-none"
                      style={{
                        fontFamily: t.type.mono,
                        fontSize: t.type.scale.sm,
                        backgroundColor: t.surface.sunken,
                        color: t.text.primary,
                        border: `1px solid ${t.border.subtle}`,
                        borderRadius: t.radius.sm,
                      }}
                    />
                    <button
                      type="submit"
                      disabled={cooling}
                      className="w-full py-2 rounded transition-opacity disabled:opacity-40"
                      style={{
                        fontFamily: t.type.display,
                        fontSize: t.type.scale.sm,
                        letterSpacing: t.type.tracking.wide,
                        backgroundColor: t.accent.primary,
                        color: t.text.inverse,
                        borderRadius: t.radius.sm,
                      }}
                    >
                      UNLOCK
                    </button>
                  </form>
                ) : null}

                <button
                  type="button"
                  onClick={() => setShowPassphrase((v) => !v)}
                  className="underline-offset-4 hover:underline"
                  style={{
                    fontFamily: t.type.body,
                    fontSize: t.type.scale.xs,
                    color: t.text.muted,
                  }}
                >
                  {showPassphrase ? 'Use voice instead' : 'Use recovery passphrase'}
                </button>
              </div>
            )}

            {status && !status.enrolled && (
              <span
                style={{ fontFamily: t.type.body, fontSize: t.type.scale.xs, color: t.text.muted }}
              >
                No voiceprint on this device — press the orb to enrol.
              </span>
            )}

            {status?.keyBackend === 'device-file' && (
              <span
                style={{ fontFamily: t.type.mono, fontSize: t.type.scale.xs, color: t.accent.danger }}
              >
                No OS keychain available — key stored in a local file.
              </span>
            )}
          </div>
        )}
    </m.div>
  )
}

/**
 * Wordmark with a chromatic-aberration flourish on unlock.
 *
 * Two offset colour copies under a `screen` blend, animating their offset to
 * zero. Only transform and opacity animate, so despite looking like a filter
 * effect it costs a compositor pass rather than a repaint — and it is skipped
 * entirely below the high tier.
 */
function Wordmark({
  unlocking,
  heavyEffects,
}: {
  unlocking: boolean
  heavyEffects: boolean
}): JSX.Element {
  const { theme } = useTheme()
  const t = theme.tokens
  const aberrate = unlocking && heavyEffects

  const base: React.CSSProperties = {
    fontFamily: t.type.display,
    fontSize: t.type.scale.lg,
    letterSpacing: '0.42em',
    textTransform: 'uppercase',
  }

  return (
    <div className="relative flex flex-col items-center gap-1">
      <div className="relative">
        {aberrate && (
          <>
            <m.span
              aria-hidden="true"
              className="absolute inset-0 whitespace-nowrap"
              style={{ ...base, color: 'var(--accent-danger)', mixBlendMode: 'screen' }}
              initial={{ x: -4 }}
              animate={{ x: 0 }}
              transition={{ duration: UNLOCK_SECONDS.aberration, ease: 'easeOut' }}
            >
              {APP_NAME}
            </m.span>
            <m.span
              aria-hidden="true"
              className="absolute inset-0 whitespace-nowrap"
              style={{ ...base, color: 'var(--accent-secondary)', mixBlendMode: 'screen' }}
              initial={{ x: 4 }}
              animate={{ x: 0 }}
              transition={{ duration: UNLOCK_SECONDS.aberration, ease: 'easeOut' }}
            >
              {APP_NAME}
            </m.span>
          </>
        )}
        <span style={{ ...base, color: t.text.primary }}>{APP_NAME}</span>
      </div>
      <span
        style={{
          fontFamily: t.type.kanji,
          fontSize: t.type.scale.xs,
          letterSpacing: '0.3em',
          color: t.text.muted,
        }}
      >
        {APP_NAME_JP}
      </span>
    </div>
  )
}

function statusLine(args: {
  phase: string
  message: string | null
  cooling: boolean
  remaining: string
  enrolled: boolean
}): string {
  if (args.cooling) return `Locked out — ${args.remaining}`
  if (args.message) return args.message
  if (args.phase === 'processing') return 'Verifying…'
  if (args.phase === 'unlocking') return 'Welcome back.'
  if (!args.enrolled) return 'Set up voice unlock'
  return 'Press the orb, then speak'
}
