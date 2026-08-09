import { Suspense, useEffect, useState } from 'react'
import { useTheme } from '../../theme/useTheme'


// Grain is not an overlay — it's a background layer applied via
// --effect-grain-image (see theme/grain.ts), so content always paints above it.

function useWindowPaused(): boolean {
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')

  useEffect(() => {
    const pause = () => setPaused(true)
    const resume = () => setPaused(document.visibilityState === 'hidden')
    window.addEventListener('blur', pause)
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      window.removeEventListener('blur', pause)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [])

  return paused
}

/**
 * Single fixed, non-interactive layer the active theme's ambient effects
 * render into. Swapping themes swaps the lazy component here — the old
 * effects unmount (and clean up their RAF loop / GL context) in the same
 * commit React mounts the new one.
 */
export function EffectsLayer() {
  const { theme, reducedMotion } = useTheme()
  const paused = useWindowPaused()
  const Effects = theme.Effects

  return (
    // z-index is the theme's call, not this component's: a sparse dark overlay
    // (fog, embers) wants to sit above content at 0, while a bright full-bleed
    // ground has to sit behind it at -1. See ThemeTokens.ambient.layerZ.
    <div className="fixed inset-0" style={{ pointerEvents: 'none', zIndex: 'var(--ambient-layer-z)' as unknown as number }}>
      <Suspense fallback={null}>
        <Effects reducedMotion={reducedMotion} paused={theme.motionProfile.pauseOnBlur && paused} />
      </Suspense>
    </div>
  )
}
