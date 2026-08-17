import { useSettingsStore } from '../stores/settingsStore'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { THEMES, DEFAULT_THEME_ID, isThemeId, type ThemeId } from './registry'
import type { Theme } from './types'

/**
 * Theme id is persisted through the existing settings store (same round-trip
 * every other setting uses — see stores/settingsStore.ts) rather than a
 * parallel React context: the store already only re-renders subscribers,
 * which is the same guarantee a context would buy us here.
 */
export function useTheme() {
  const rawId = useSettingsStore((s) => s.settings.theme)
  const setSetting = useSettingsStore((s) => s.set)
  const reducedMotion = useReducedMotion()

  const themeId: ThemeId = isThemeId(rawId) ? rawId : DEFAULT_THEME_ID
  // Widened to the contract on purpose. `THEMES` is `satisfies`-typed, so its
  // inferred union is the literal shape of each entry — and a consumer reading
  // an optional part of the contract (`particles`, `watermark`, `frame`) would
  // otherwise fail to compile the moment one theme omits it, which is exactly
  // what "optional" is for.
  const theme: Theme = THEMES[themeId]

  const setTheme = (id: ThemeId): void => {
    const html = document.documentElement
    html.setAttribute('data-theme-transitioning', 'true')
    setSetting('theme', id)
    window.setTimeout(() => html.removeAttribute('data-theme-transitioning'), 280)
  }

  return { theme, themeId, setTheme, reducedMotion }
}
