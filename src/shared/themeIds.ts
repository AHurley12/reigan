/**
 * Theme ids and their display names. The full themes — tokens, lazy-loaded
 * Effects components, watermarks — stay in `renderer/theme/registry.ts`, which
 * `satisfies Record<ThemeId, Theme>` against this list, so the two cannot
 * drift.
 *
 * Split out so the main process can name the active theme; it cannot import
 * the registry, which pulls in React and CSS.
 */
export const THEME_NAMES = {
  shingan: 'Shingan',
  gothic: 'Sepulchral',
  aero: 'Frutiger Aero',
} as const

export type ThemeId = keyof typeof THEME_NAMES

export const DEFAULT_THEME_ID: ThemeId = 'shingan'

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && v in THEME_NAMES
}
