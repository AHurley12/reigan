import type { ThemeTokens } from '../../types'
import './fonts.css'
import './signature.css'
import './ornament.css'

/**
 * Sepulchral — Victorian mourning restraint, not Halloween aisle.
 * Cold-undertone black, oxblood accent, tarnished-silver text, verdigris
 * as the one desaturated "cool" counterpoint. See design plan for the
 * measured contrast ratios this palette was picked to satisfy.
 */
export const gothicTokens: ThemeTokens = {
  surface: {
    base: '#0A0B0F',
    raised: '#16181F',
    overlay: '#1D2029',
    sunken: '#06070A',
    scrim: 'rgba(6, 7, 10, 0.72)',
    // Struck metal, not glass: a tarnished-silver lip at the top and a carved
    // shadow beneath. Same tokens, different material.
    glossTop: 'rgba(198, 195, 186, 0.10)',
    glossBottom: 'rgba(0, 0, 0, 0.30)',
    glassTint: 'rgba(10, 11, 15, 0.55)',
    glassBlur: '10px',
  },
  text: {
    primary: '#ADABA3',
    secondary: '#87827A',
    muted: '#524F49',
    inverse: '#0A0B0F',
    accent: '#8C2B3B',
    kanji: '#87827A',
    onAccent: '#E8E4DA',
    onGlass: '#ADABA3',
  },
  accent: {
    primary: '#6E1423',
    secondary: '#4A6656',
    danger: '#9E2A3D',
    success: '#4A6656',
    gradient: 'linear-gradient(135deg, #6E1423 0%, #4A6656 100%)',
  },
  // Crimson, verdigris, azure. The skin's own crimson (#6E1423) and verdigris
  // (#4A6656) are wall colours — as marks they fall under the chroma floor and
  // read as two greys, so these are lifted, saturated relatives of both. Azure
  // is the third because gothic has no third hue of its own, and a cold blue is
  // the one addition that stays in the crypt.
  chart: {
    series1: '#C73751',
    series2: '#0BAA7C',
    series3: '#197AE3',
  },
  border: {
    subtle: 'rgba(173, 171, 163, 0.08)',
    strong: 'rgba(173, 171, 163, 0.16)',
    focus: '#C1495B',
  },
  state: {
    tint: '#FFFFFF',
    selected: 'rgba(255, 255, 255, 0.10)',
    disabledOpacity: '0.4',
  },
  // The silver lining / engraved shadow pair that ornament.css already draws
  // by hand, promoted to tokens so a skin can restate the material once.
  edge: {
    highlight: 'rgba(198, 195, 186, 0.16)',
    shadow: 'rgba(0, 0, 0, 0.55)',
  },
  bevel: {
    outer: '0 8px 24px rgba(0, 0, 0, 0.6)',
    inner: 'inset 0 1px 0 rgba(198, 195, 186, 0.16)',
    pressed: 'none',
    cast: 'rgba(0, 0, 0, 0.5)',
  },
  sheen: {
    angle: '180deg',
    specular: 'transparent',
  },
  ambient: {
    layerOpacity: '1',
    layerBlend: 'normal',
    layerZ: '0',
  },
  focus: {
    glow: 'none',
  },
  effect: {
    glow: '0 0 24px rgba(110, 20, 35, 0.45)',
    noiseOpacity: '0.04',
    texture: 'none',
  },
  // lg is 10px because the ornate frame's corner arc is cut at that radius
  // (see frame.ts); change one and the moulding stops tracking the edge of
  // the box it sits on.
  radius: { sm: '3px', md: '6px', lg: '10px', pill: '999px' },
  space: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '40px' },
  type: {
    display: "'Cormorant Garamond', serif",
    body: "'IBM Plex Sans', sans-serif",
    mono: "'IBM Plex Mono', monospace",
    // Mincho to partner the serif Latin face — the Japanese equivalent of the
    // serif/sans distinction. Resolved from the system rather than bundled:
    // a JP webfont is ~1MB of subsets for the handful of kanji labels we show.
    kanji: "'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'MS Mincho', serif",
    seal: "'Cormorant Garamond', 'Yu Mincho', serif",
    scale: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '28px', display: '44px' },
    weight: { normal: 400, medium: 500, bold: 600 },
    tracking: { tight: '-0.01em', normal: '0', wide: '0.08em' },
  },
  motion: {
    durationFast: '150ms',
    durationBase: '240ms',
    durationSlow: '420ms',
    easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeExit: 'cubic-bezier(0.7, 0, 1, 0.5)',
  },
}
