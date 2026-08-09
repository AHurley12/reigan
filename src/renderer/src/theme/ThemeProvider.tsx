import { useLayoutEffect, type ReactNode } from 'react'
import { useTheme } from './useTheme'
import { applyTokens, applyThemeVars } from './applyTokens'

/**
 * Applies the active theme's tokens to :root ahead of paint (useLayoutEffect,
 * not useEffect) so a theme switch never flashes the previous palette.
 * Deliberately renders no context — components that don't call useTheme()
 * never re-render when the theme changes, satisfying rule #2 for free.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useTheme()

  useLayoutEffect(() => {
    applyTokens(theme.tokens)
    applyThemeVars(theme)
    document.documentElement.setAttribute('data-theme', theme.id)
    document.documentElement.style.colorScheme = theme.colorScheme
  }, [theme])

  return <>{children}</>
}
