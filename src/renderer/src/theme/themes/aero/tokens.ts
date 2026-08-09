import type { ThemeTokens } from '../../types'
import './aero.css'

/**
 * Frutiger Aero — 2007–2012. Vista Aero glass, early iOS gloss, Zune HD,
 * dew-on-grass stock photography.
 *
 * Two decisions drive everything else:
 *
 * `surface.base` is *transparent*, not a colour. Every other skin paints an
 * opaque ground and lets its ambient layer float on top. Aero inverts that: the
 * depth-water gradient and everything swimming in it is the ground, rendered by
 * the ambient layer behind all content (ambient.layerZ = -1), and the surfaces
 * above it are glass. If base were opaque the ambient layer would be invisible.
 *
 * Text is dark teal (#06303F), never black. Black on a saturated aqua glass
 * reads as cheap, and the period never used it.
 */
export const aeroTokens: ThemeTokens = {
  surface: {
    // Deliberately transparent — see the note above. Kept as an rgba rather
    // than the keyword so applyTokens can still derive an --rgb-* triplet
    // from it; `transparent` would parse to nothing and break bg-void.
    base: 'rgba(127, 212, 245, 0)',
    // Glass. Panels are a white veil over whatever is drifting behind them.
    raised: 'rgba(255, 255, 255, 0.40)',
    overlay: 'rgba(255, 255, 255, 0.55)',
    sunken: 'rgba(11, 110, 150, 0.16)',
    scrim: 'rgba(6, 62, 86, 0.44)',
    glossTop: 'rgba(255, 255, 255, 0.24)',
    glossBottom: 'rgba(201, 221, 232, 0.08)',
    glassTint: 'rgba(244, 251, 255, 0.40)',
    // 9px, not 14: at 14 the blur erased the bubbles behind the panels
    // entirely, and since the panels cover most of the window that left the
    // ambient layer visible only in the gutters. 9 still frosts, but shapes
    // survive it. The budget allows four of these on screen at once; small
    // repeated elements fake glass with a gradient instead.
    glassBlur: '9px',
  },
  text: {
    primary: '#06303F',
    secondary: '#134B60',
    muted: '#234657',
    inverse: '#F4FBFF',
    accent: '#0B6E96',
    kanji: '#234657',
    onAccent: '#FFFFFF',
    onGlass: '#06303F',
  },
  accent: {
    primary: '#16A8D8',
    // Lime is a garnish. If the UI reads green rather than aqua it is
    // overused — it belongs on active states, success, and small highlights.
    secondary: '#8FD400',
    danger: '#D9452F',
    success: '#8FD400',
    // A gloss button, not a two-stop ramp: specular white across the upper
    // 45% with a *hard* terminator, then the saturated fill beneath. That
    // abrupt edge is the detail that reads as 2007 rather than as a modern
    // soft gradient.
    gradient:
      'linear-gradient(180deg, rgba(255,255,255,0.62) 0%, rgba(255,255,255,0.48) 45%, #16A8D8 45.01%, #0B6E96 100%)',
  },
  border: {
    subtle: 'rgba(6, 62, 86, 0.14)',
    strong: 'rgba(6, 62, 86, 0.28)',
    focus: '#16A8D8',
  },
  // Light skin, so the interaction wash tints *down* with the text ink.
  // A white tint here would be invisible, which is exactly the bug the token
  // exists to prevent.
  state: {
    tint: '#06303F',
    selected: 'rgba(22, 168, 216, 0.24)',
    disabledOpacity: '0.45',
  },
  // The wet light line along the top of every surface, and the water-shadow
  // under it. This pair is what stops a panel reading as a flat rectangle.
  edge: {
    highlight: 'rgba(255, 255, 255, 0.9)',
    shadow: 'rgba(11, 110, 150, 0.22)',
  },
  bevel: {
    outer: '0 8px 24px rgba(6, 62, 86, 0.26)',
    inner: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 -1px 0 rgba(11, 110, 150, 0.22)',
    pressed: 'inset 0 2px 6px rgba(6, 62, 86, 0.34), inset 0 -1px 0 rgba(255, 255, 255, 0.5)',
    cast: 'rgba(6, 62, 86, 0.24)',
  },
  sheen: {
    angle: '180deg',
    specular: 'rgba(255, 255, 255, 0.60)',
  },
  ambient: {
    layerOpacity: '1',
    layerBlend: 'normal',
    layerZ: '-1',
  },
  focus: {
    glow: '0 0 0 4px rgba(22, 168, 216, 0.30)',
  },
  effect: {
    glow: '0 0 22px rgba(22, 168, 216, 0.45)',
    // No grain: Aero is wet and polished, and film noise fights the gloss.
    noiseOpacity: '0',
    texture: 'none',
  },
  // 8–14px corners — the era's range. lg also drives .ornate's radius.
  radius: { sm: '5px', md: '9px', lg: '13px', pill: '999px' },
  space: { xs: '8px', sm: '16px', md: '24px', lg: '32px', xl: '48px' },
  type: {
    // Frutiger is a humanist sans. Segoe UI is the closest thing installed on
    // every machine this app runs on, and it is also the *correct* period
    // reference — it is the face Vista and 7 shipped. Frutiger and Myriad are
    // listed ahead of it for anyone who actually has them.
    display: "'Frutiger', 'Segoe UI Semibold', 'Segoe UI', 'Myriad Pro', 'Corbel', system-ui, sans-serif",
    body: "'Frutiger', 'Segoe UI', 'Myriad Pro', 'Corbel', 'Candara', system-ui, sans-serif",
    mono: "'Consolas', 'Lucida Console', 'Courier New', monospace",
    // Meiryo shipped with Vista and is the period-correct Japanese partner to
    // Segoe UI — humanist, rounded, and designed for the same ClearType era.
    kanji: "'Meiryo', 'Yu Gothic UI', 'MS PGothic', sans-serif",
    seal: "'Segoe UI', 'Corbel', sans-serif",
    scale: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '28px', display: '44px' },
    weight: { normal: 400, medium: 600, bold: 700 },
    // Headers get a touch of extra tracking; the era set its display type wide.
    tracking: { tight: '-0.005em', normal: '0', wide: '0.045em' },
  },
  motion: {
    durationFast: '140ms',
    durationBase: '220ms',
    durationSlow: '340ms',
    easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
}
