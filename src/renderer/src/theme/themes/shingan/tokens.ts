import type { ThemeTokens } from '../../types'

/**
 * Baseline theme — carries forward the exact values shipped by the Shingan
 * hanko/viewfinder redesign (src/renderer/src/styles/globals.css :root),
 * reorganized into the semantic token shape instead of a new palette.
 */
export const shinganTokens: ThemeTokens = {
  surface: {
    base: '#0B0A08',
    raised: '#16140F',
    overlay: '#1E1B15',
    sunken: '#272319',
    scrim: 'rgba(11, 10, 8, 0.7)',
    // Material tokens exist for every skin so components never branch, but a
    // flat ink-void UI has no gloss to speak of — these are deliberately near
    // invisible rather than absent.
    glossTop: 'rgba(237, 230, 214, 0.04)',
    glossBottom: 'rgba(0, 0, 0, 0.10)',
    glassTint: 'rgba(0, 0, 0, 0)',
    glassBlur: '0px',
  },
  text: {
    primary: '#EDE6D6',
    secondary: '#B5AB98',
    muted: '#6B6455',
    inverse: '#0B0A08',
    accent: '#E0A54A',
    kanji: '#8A8065',
    onAccent: '#FFFFFF',
    onGlass: '#EDE6D6',
  },
  accent: {
    primary: '#D8432A',
    secondary: '#23A18C',
    danger: '#E5484D',
    success: '#23A18C',
    gradient: 'linear-gradient(135deg, #D8432A 0%, #C9A227 100%)',
  },
  border: {
    subtle: 'rgba(237, 230, 214, 0.07)',
    strong: 'rgba(237, 230, 214, 0.14)',
    focus: '#23A18C',
  },
  // Dark skins wash with white; `tint` is solid so Tailwind can compose any
  // alpha onto it (bg-tint/5, bg-tint/10) from a single token.
  state: {
    tint: '#FFFFFF',
    selected: 'rgba(255, 255, 255, 0.10)',
    disabledOpacity: '0.4',
  },
  edge: {
    highlight: 'transparent',
    shadow: 'transparent',
  },
  bevel: {
    outer: '0 8px 24px rgba(0, 0, 0, 0.45)',
    inner: 'inset 0 1px 0 rgba(237, 230, 214, 0.04)',
    pressed: 'none',
    cast: 'rgba(0, 0, 0, 0.4)',
  },
  sheen: {
    angle: '180deg',
    specular: 'transparent',
  },
  ambient: {
    // Shingan ships no ambient layer (its Effects returns null); the opacity
    // records that rather than relying on the component to be empty.
    layerOpacity: '0',
    layerBlend: 'normal',
    layerZ: '0',
  },
  focus: {
    glow: 'none',
  },
  effect: {
    glow: '0 0 20px rgba(216, 67, 42, 0.35)',
    noiseOpacity: '0',
    texture: 'none',
  },
  radius: { sm: '6px', md: '8px', lg: '12px', pill: '999px' },
  space: { xs: '8px', sm: '16px', md: '24px', lg: '32px', xl: '48px' },
  type: {
    display: "'Rajdhani', 'Zen Kaku Gothic New', sans-serif",
    body: "'Inter', 'Noto Sans JP', sans-serif",
    mono: "'JetBrains Mono', 'Noto Sans JP', monospace",
    kanji: "'Zen Kaku Gothic New', 'Noto Sans JP', sans-serif",
    seal: "'Shippori Mincho B1', 'Zen Kaku Gothic New', serif",
    scale: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '28px', display: '44px' },
    weight: { normal: 400, medium: 500, bold: 700 },
    tracking: { tight: '-0.01em', normal: '0', wide: '0.06em' },
  },
  motion: {
    durationFast: '120ms',
    durationBase: '200ms',
    durationSlow: '300ms',
    easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeExit: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
}
