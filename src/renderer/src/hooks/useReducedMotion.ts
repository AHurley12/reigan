import { useEffect, useState } from 'react'
import { useSettingsStore } from '../stores/settingsStore'

function systemPrefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Combines the user's OS-level preference with the in-app override, and keeps
 *  `<html data-reduced-motion>` in sync so plain CSS animations respect it too. */
export function useReducedMotion(): boolean {
  const settingOverride = useSettingsStore((s) => s.settings.reducedMotion)
  const [systemPref, setSystemPref] = useState(systemPrefersReducedMotion)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = () => setSystemPref(mql.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  const reduced = settingOverride || systemPref

  useEffect(() => {
    document.documentElement.setAttribute('data-reduced-motion', String(reduced))
  }, [reduced])

  return reduced
}
