import { m } from 'framer-motion'
import { useTheme } from '../../theme/useTheme'
import { CircularWaveform } from './CircularWaveform'
import type { QualityTier } from '../../hooks/useAdaptivePerformance'
import type { AuthPhase } from '../../../../shared/auth-types'

/**
 * The lock screen's focal element.
 *
 * Structure follows the brief's split: everything static is SVG (viewfinder
 * brackets, the ring furniture, the seal ticks), and the only canvas is the
 * live waveform, which mounts solely while listening.
 *
 * Visual language is Shingan's, not generic sci-fi: the framing marks are the
 * same hanko/viewfinder motif the rest of the app uses, and every colour comes
 * from theme tokens, so the orb is vermillion under Shingan and whatever the
 * gothic theme defines under gothic — no hard-coded accent anywhere.
 *
 * Must be rendered inside a <LazyMotion> — it uses `m` rather than `motion`.
 */

interface AuthOrbProps {
  phase: AuthPhase
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  tier: QualityTier
  reducedMotion: boolean
  suspended: boolean
  size?: number
  onActivate?: () => void
  disabled?: boolean
}

/** Breathing period per phase. Idle is slow and calm; listening is alert. */
const BREATH_MS: Partial<Record<AuthPhase, number>> = {
  idle: 4200,
  listening: 2000,
  cooldown: 6000,
}

export function AuthOrb({
  phase,
  analyserRef,
  tier,
  reducedMotion,
  suspended,
  size = 260,
  onActivate,
  disabled = false,
}: AuthOrbProps): JSX.Element {
  const { theme } = useTheme()
  const t = theme.tokens
  const accent = phase === 'failed' ? t.accent.danger : t.accent.primary
  const halo = phase === 'failed' ? t.accent.danger : t.accent.secondary

  const listening = phase === 'listening'
  const processing = phase === 'processing'
  const animate = !reducedMotion && !suspended

  // Breathing. Reduced motion swaps the scale pulse for a still element —
  // never a smaller pulse, which is still motion.
  const breathe = animate && BREATH_MS[phase]
    ? {
        scale: [1, 1.035, 1],
        transition: {
          duration: BREATH_MS[phase]! / 1000,
          repeat: Infinity,
          ease: 'easeInOut' as const,
        },
      }
    : { scale: 1 }

  // Failure: a short, sharp horizontal shake. Deliberately not a spring —
  // springs feel playful, and this is the one moment that should not.
  const shake = animate
    ? { x: [0, -9, 8, -6, 4, -2, 0], transition: { duration: 0.45, ease: 'easeOut' as const } }
    : { opacity: [1, 0.55, 1], transition: { duration: 0.3 } }

  return (
    <div
      className="relative flex items-center justify-center select-none"
      style={{ width: size, height: size }}
    >
      {/* Static furniture — SVG, never repainted. */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        aria-hidden="true"
        className="absolute inset-0"
        style={{ overflow: 'visible' }}
      >
        <circle cx="50" cy="50" r="46" fill="none" stroke={t.border.subtle} strokeWidth="0.4" />
        <circle cx="50" cy="50" r="38" fill="none" stroke={t.border.subtle} strokeWidth="0.3" />
        {/* Viewfinder brackets — the app's existing framing motif. */}
        {[0, 90, 180, 270].map((deg) => (
          <path
            key={deg}
            d="M 50 2 L 50 8 M 44 4 L 56 4"
            fill="none"
            stroke={t.border.strong}
            strokeWidth="0.6"
            strokeLinecap="square"
            transform={`rotate(${deg} 50 50)`}
          />
        ))}
        {/* Seal ticks. Dropped entirely on the low tier. */}
        {tier !== 'low' &&
          Array.from({ length: 24 }, (_, i) => (
            <line
              key={i}
              x1="50"
              y1="10"
              x2="50"
              y2="12.5"
              stroke={t.border.subtle}
              strokeWidth="0.35"
              transform={`rotate(${i * 15} 50 50)`}
            />
          ))}
      </svg>

      {/* Processing ring — one rotating dashed circle, GPU-composited. */}
      {processing && (
        <m.svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          aria-hidden="true"
          className="absolute inset-0"
          style={{ willChange: animate ? 'transform' : undefined }}
          animate={animate ? { rotate: 360 } : { opacity: [0.4, 1, 0.4] }}
          transition={
            animate
              ? { duration: 1.1, repeat: Infinity, ease: 'linear' }
              : { duration: 1.2, repeat: Infinity }
          }
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={accent}
            strokeWidth="1"
            strokeLinecap="round"
            strokeDasharray="18 246"
          />
        </m.svg>
      )}

      {/* Live waveform — mounted only while there is audio to show. */}
      {(listening || processing) && (
        <CircularWaveform
          analyserRef={analyserRef}
          active={listening}
          tier={tier}
          suspended={suspended}
          size={size}
        />
      )}

      {/* The orb itself. */}
      <m.button
        type="button"
        onClick={disabled ? undefined : onActivate}
        disabled={disabled}
        aria-label={orbLabel(phase)}
        className="relative rounded-full outline-none focus-visible:ring-2"
        style={{
          width: size * 0.42,
          height: size * 0.42,
          cursor: disabled ? 'default' : 'pointer',
          background: `radial-gradient(circle at 38% 32%, ${halo} 0%, ${accent} 55%, ${t.surface.base} 100%)`,
          boxShadow:
            phase === 'failed'
              ? `0 0 34px 2px ${t.accent.danger}`
              : listening
                ? t.effect.glow
                : 'none',
          // Only hint the compositor while something is actually moving.
          willChange: animate && phase !== 'unlocking' ? 'transform' : undefined,
        }}
        animate={phase === 'failed' ? shake : breathe}
        whileHover={disabled || reducedMotion ? undefined : { scale: 1.06 }}
        whileTap={disabled || reducedMotion ? undefined : { scale: 0.97 }}
      />
    </div>
  )
}

function orbLabel(phase: AuthPhase): string {
  switch (phase) {
    case 'listening':
      return 'Listening — speak your passphrase'
    case 'processing':
      return 'Verifying'
    case 'unlocking':
      return 'Unlocked'
    case 'failed':
      return 'Not recognised — try again'
    case 'cooldown':
      return 'Locked out — cooldown active'
    default:
      return 'Press to speak your passphrase'
  }
}
