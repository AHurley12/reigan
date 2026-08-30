import { useEffect, useState } from 'react'

/**
 * True while the window is blurred or hidden, so ambient layers can honour
 * `motionProfile.pauseOnBlur`.
 *
 * Lives here rather than inside EffectsLayer because two separate hosts now
 * need it — the full-viewport layer and the per-region particle fields — and
 * two copies would be two chances for them to disagree about what "paused"
 * means and animate against each other.
 */
export function useWindowPaused(): boolean {
  const [paused, setPaused] = useState(
    () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
  )

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
