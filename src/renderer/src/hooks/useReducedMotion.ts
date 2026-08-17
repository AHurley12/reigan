import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { resolveReducedMotion } from './motionPreference'

function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * The OS preference on its own, live. Exported so the settings UI can say what
 * "Match system" currently resolves to — without that, a user whose OS reduces
 * motion sees a control that appears to do nothing.
 */
export function useSystemPrefersReducedMotion(): boolean {
  const [systemPref, setSystemPref] = useState(systemPrefersReducedMotion)
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setSystemPref(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return systemPref
}

/**
 * Resolves the app's motion preference against the OS one, and keeps
 * `<html data-reduced-motion>` in sync so plain CSS animations respect it too.
 *
 * `system` follows the OS. `reduce` and `full` are explicit overrides, and the
 * second of those is the point: the setting used to be a boolean OR-ed with the
 * media query, so on a machine with "show animations" turned off the control
 * was inert and no animation in the app could ever run. Following an
 * accessibility preference by default is right; making it unappealable is not.
 */
export function useReducedMotion(): boolean {
  const preference = useSettingsStore((s) => s.settings.motion)
  const systemPref = useSystemPrefersReducedMotion()

  const reduced = resolveReducedMotion(preference, systemPref)

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', String(reduced))
  }, [reduced])

  return reduced
}
