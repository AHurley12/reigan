import type { Theme, ThemeTokens } from './types'
import { grainTile } from './grain'

/**
 * Reigan's existing chrome (23+ components) already consumes a fixed set of
 * legacy var names (--bg-void, --reigan-primary, --gold, ...) established by
 * the Shingan redesign. Rather than rewrite every call site to the new
 * semantic names, each legacy var is redefined here as a reference to the
 * new token it now represents — switching themes reskins the whole app
 * without touching component code. New code should prefer the canonical
 * names on the left of CANONICAL_KEYS (--surface-base, --accent-primary, …).
 */
const LEGACY_ALIASES: Record<string, string> = {
  '--bg-void': 'var(--surface-base)',
  '--bg-surface': 'var(--surface-raised)',
  '--bg-elevated': 'var(--surface-overlay)',
  '--bg-subtle': 'var(--surface-sunken)',
  '--reigan-primary': 'var(--accent-primary)',
  '--reigan-secondary': 'var(--accent-secondary)',
  // The lock screen and auth orb read this one name rather than reaching for a
  // specific token, so the unlock sequence follows whatever accent the active
  // theme defines instead of hard-coding a colour.
  '--reigan-accent': 'var(--accent-primary)',
  '--gold': 'var(--accent-secondary)',
  '--reigan-gradient': 'var(--accent-gradient)',
  '--reigan-glow': 'var(--effect-glow)',
  '--reigan-glow-jade': '0 0 20px color-mix(in srgb, var(--accent-secondary) 35%, transparent)',
  '--active': 'var(--accent-secondary)',
  '--alert': 'var(--accent-secondary)',
  '--critical': 'var(--accent-danger)',
  '--info': 'var(--accent-secondary)',
  // --text-kanji and --text-accent are deliberately NOT aliased: both are real
  // tokens now (text.kanji / text.accent), and aliasing them here would
  // overwrite the token with whatever the alias pointed at. That is exactly
  // what used to happen — shingan declared text.accent as gold #E0A54A and the
  // alias silently re-pointed it at jade, making the token dead code.
  '--border': 'var(--border-subtle)',
  '--border-hover': 'var(--border-strong)',
  '--border-accent': 'var(--border-focus)',
  '--font-display': 'var(--type-display)',
  '--font-body': 'var(--type-body)',
  '--font-mono': 'var(--type-mono)',
  '--font-kanji': 'var(--type-kanji)',
  '--font-seal': 'var(--type-seal)',
  '--ease-spring': 'var(--motion-ease-enter)',
  '--ease-standard': 'var(--motion-ease-standard)',
  '--duration-fast': 'var(--motion-duration-fast)',
  '--duration-normal': 'var(--motion-duration-base)',
  '--duration-slow': 'var(--motion-duration-slow)',
}

/**
 * Tailwind's opacity modifier (`bg-tint/10`) can only work if the colour is
 * declared as `rgb(<channels> / <alpha-value>)`, which means the custom
 * property has to hold bare channels — `255 255 255`, not `#FFFFFF`. So every
 * token that parses as a colour is published twice: once as itself for inline
 * styles, and once as `--rgb-*` for the Tailwind config to compose alpha onto.
 *
 * Returns null for anything that isn't a colour (`10px`, `0.4`, `none`,
 * `transparent`), which is how non-colour tokens are skipped without a list to
 * keep in sync.
 */
function channels(value: string): string | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h
    const n = parseInt(full, 16)
    return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
  }
  const fn = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(value.trim())
  if (fn) return `${Math.round(+fn[1])} ${Math.round(+fn[2])} ${Math.round(+fn[3])}`
  return null
}

function kebabSegment(segment: string): string {
  return segment.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

function kebabPath(path: string[]): string {
  return `--${path.map(kebabSegment).join('-')}`
}

function flatten(node: unknown, path: string[], out: Record<string, string>): void {
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      flatten(value, [...path, key], out)
    }
  } else {
    out[kebabPath(path)] = String(node)
  }
}

/** Flattens a theme's tokens onto :root as CSS custom properties, plus the legacy alias layer. */
export function applyTokens(tokens: ThemeTokens): void {
  const flat: Record<string, string> = {}
  flatten(tokens, [], flat)

  const root = document.documentElement.style
  for (const [name, value] of Object.entries(flat)) {
    root.setProperty(name, value)
    const rgb = channels(value)
    if (rgb !== null) root.setProperty(`--rgb-${name.slice(2)}`, rgb)
  }
  for (const [legacyName, reference] of Object.entries(LEGACY_ALIASES)) {
    root.setProperty(legacyName, reference)
  }

  const noise = Number(tokens.effect.noiseOpacity)
  root.setProperty('--effect-grain-image', noise > 0 ? grainTile(noise) : 'none')

  // Per-REIGAN-state status colours, derived rather than declared: a skin
  // states its accents once and the status ring, avatar spinner and orb all
  // follow. See STATE_COLORS in shared/constants.ts for the consumer side.
  root.setProperty('--status-idle', tokens.text.muted)
  root.setProperty('--status-listening', tokens.accent.secondary)
  root.setProperty('--status-processing', tokens.accent.primary)
  root.setProperty('--status-speaking', tokens.text.accent)
  root.setProperty('--status-error', tokens.accent.danger)
  root.setProperty('--status-success', tokens.accent.success)
}

/**
 * Theme-level properties that live outside the token tree. Kept here beside
 * applyTokens so there is exactly one module that writes to :root.
 * (textReveal is not published as a var — InscribeText reads it from the
 * theme object directly and writes it onto each unit.)
 */
export function applyThemeVars(theme: Theme): void {
  const root = document.documentElement.style
  root.setProperty('--theme-watermark', theme.watermark ? theme.watermark() : 'none')

  // A theme without a frame publishes `none` and a zero slice, which makes
  // .ornate collapse to the plain hairline it already declares — no branching
  // needed at the call sites.
  const frame = theme.frame?.()
  root.setProperty('--theme-frame', frame ? frame.base : 'none')
  root.setProperty('--theme-frame-focus', frame ? frame.focus : 'none')
  root.setProperty('--theme-frame-slice', frame ? String(frame.slice) : '0')
  root.setProperty('--theme-frame-width', frame ? `${frame.slice}px` : '0')
}
