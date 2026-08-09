import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

/**
 * Frame-budget monitoring with hysteresis, plus Page Visibility suspension.
 *
 * The lock screen is the worst place in the app to burn GPU: it can sit on
 * screen for hours on a machine the user has walked away from. So this hook
 * does two jobs — it decides how much animation the machine can afford, and it
 * shuts the whole thing down when nobody is looking.
 *
 * Hysteresis matters more than the thresholds. A monitor that degrades at 45
 * and recovers at 45 oscillates: dropping the particle layer raises the frame
 * rate, which restores the particle layer, which drops the frame rate. The
 * recovery bar is therefore well above the degrade bar, and recovery needs
 * several consecutive good windows where degradation needs two.
 */

export type QualityTier = 'high' | 'medium' | 'low'

export interface AdaptivePerformance {
  tier: QualityTier
  /** Rolling estimate, 0 until the first window closes. */
  fps: number
  /** False when the window is hidden or occluded. */
  visible: boolean
  /** Animations should be fully stopped — hidden window, or reduced motion. */
  suspended: boolean
  /** Convenience: expensive optional layers (particles, blur) are affordable. */
  allowParticles: boolean
}

const WINDOW_MS = 1000
const DEGRADE_FPS = 45
const RECOVER_FPS = 55
const DEGRADE_WINDOWS = 2
const RECOVER_WINDOWS = 4

const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high']

function step(tier: QualityTier, direction: -1 | 1): QualityTier {
  const i = TIER_ORDER.indexOf(tier)
  return TIER_ORDER[Math.max(0, Math.min(TIER_ORDER.length - 1, i + direction))]
}

/**
 * @param enabled Gate the rAF sampler. Pass false whenever the consumer is
 *   unmounted or off-screen — the sampler is cheap but it is not free, and an
 *   always-on measurement loop defeats the purpose of measuring.
 */
export function useAdaptivePerformance(enabled = true): AdaptivePerformance {
  const reducedMotion = useReducedMotion()
  const [tier, setTier] = useState<QualityTier>('high')
  const [fps, setFps] = useState(0)
  const [visible, setVisible] = useState(() => !document.hidden)

  // Kept in refs so the sampler never re-subscribes mid-measurement.
  const badWindows = useRef(0)
  const goodWindows = useRef(0)
  const tierRef = useRef<QualityTier>('high')
  tierRef.current = tier

  useEffect(() => {
    const onVisibility = (): void => setVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(() => {
    // No point sampling when nothing is animating: reduced motion pins the
    // tier, and a hidden window reports throttled frame times that would be
    // misread as the GPU struggling.
    if (!enabled || !visible || reducedMotion) return

    let raf = 0
    let frames = 0
    let windowStart = performance.now()

    const tick = (now: number): void => {
      frames++
      const elapsed = now - windowStart

      if (elapsed >= WINDOW_MS) {
        const measured = (frames * 1000) / elapsed
        setFps(Math.round(measured))

        if (measured < DEGRADE_FPS) {
          goodWindows.current = 0
          badWindows.current++
          if (badWindows.current >= DEGRADE_WINDOWS && tierRef.current !== 'low') {
            badWindows.current = 0
            setTier((t) => step(t, -1))
          }
        } else if (measured >= RECOVER_FPS) {
          badWindows.current = 0
          goodWindows.current++
          if (goodWindows.current >= RECOVER_WINDOWS && tierRef.current !== 'high') {
            goodWindows.current = 0
            setTier((t) => step(t, 1))
          }
        } else {
          // Between the bars: hold position, decay both counters so a long
          // stretch of mediocre frames does not eventually trip either rule.
          badWindows.current = Math.max(0, badWindows.current - 1)
          goodWindows.current = Math.max(0, goodWindows.current - 1)
        }

        frames = 0
        windowStart = now
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [enabled, visible, reducedMotion])

  const suspended = !visible || reducedMotion

  return {
    tier: reducedMotion ? 'low' : tier,
    fps,
    visible,
    suspended,
    allowParticles: !suspended && tier === 'high',
  }
}
