import type { ThemeTokens } from '../../types'
import './fonts.css'
import './sakura.css'

/**
 * Sakura — Yozakura (夜桜), night hanami.
 *
 * The brief was a temple garden, and the approved palette was washi paper: a
 * light ground with sumi ink on it. It is built here at night instead, and the
 * inversion is the whole design.
 *
 * Two reasons. Aero is the app's light skin, and a second bright surface would
 * have had the two reading as variants of one idea rather than as two skins.
 * And a petal system is a *subtractive* mark on paper — dark specks falling
 * past text — where at night it is an emissive one, catching lantern light on
 * the way down. The signature only works in the second case.
 *
 * So the palette is the same garden after dusk: the paper became the ink
 * (`text.primary` is the washi tone, now doing the writing), the ground went to
 * a plum-black that is never neutral, and the rose is lit rather than pigment.
 * Moss stays the only cool note, as specified.
 */
export const sakuraTokens: ThemeTokens = {
  surface: {
    // Plum undertone, not neutral black. A true #000-family ground under a rose
    // accent reads as greyscale-plus-pink; the violet bias is what makes the
    // rose look like light falling on something rather than a swatch.
    base: '#14121A',
    raised: '#1E1B24',
    overlay: '#272231',
    sunken: '#0E0C12',
    scrim: 'rgba(10, 9, 14, 0.72)',
    // Lantern light arrives from above, so the gloss is a faint warm lift on
    // the top edge and a plain darkening below.
    glossTop: 'rgba(232, 223, 214, 0.045)',
    glossBottom: 'rgba(0, 0, 0, 0.16)',
    glassTint: 'rgba(30, 27, 36, 0.55)',
    // Modest: this skin's glass is paper-thin shoji, not Aero's water. The
    // budget is four large blurred surfaces and the app already has that many.
    glassBlur: '8px',
  },
  text: {
    // The washi tone from the approved daylight palette, inverted into the ink
    // role. Warm off-white, never pure #FFF — paper has a colour.
    primary: '#E8DFD6',
    secondary: '#B8ACA2',
    // Measured up from #8A7F84, which came in at 4.40 on surface.raised — under
    // the 4.5 text threshold. `muted` is not a DoD-required token and no other
    // skin clears AA here, but it also feeds --status-idle, so the whole idle
    // state got a little more legible for free.
    muted: '#94888D',
    inverse: '#14121A',
    // A brighter draw of the same lantern as accent.primary. Text needs more
    // luminance than a fill does, so this is the rose one step up rather than a
    // second hue — the palette stays at two chromatic notes.
    accent: '#F0B9C4',
    // Japanese labels run quieter than body copy by design (see the token doc),
    // but they are still functional text, so this clears AA rather than sitting
    // at the decorative level a purely ornamental kanji could take.
    kanji: '#B0A0A6',
    // Lantern rose is a *light* fill. White on it fails; this is the mirror of
    // the light-skin state.tint trap the contract warns about.
    onAccent: '#1A1016',
    onGlass: '#E8DFD6',
  },
  accent: {
    primary: '#E39AA8',
    // Moss — the only cool note in the palette, per the brief. Everything else
    // is rose or ink.
    secondary: '#6E8560',
    danger: '#DC4B4B',
    // A lighter moss than `secondary`: success is a status signal read at a
    // glance against the ink ground, where #6E8560 is dim enough to be missed.
    success: '#7E9970',
    gradient: 'linear-gradient(135deg, #E39AA8 0%, #C4707E 100%)',
  },
  border: {
    subtle: 'rgba(232, 223, 214, 0.075)',
    strong: 'rgba(232, 223, 214, 0.15)',
    focus: '#C4707E',
  },
  // Dark skin, so the interaction wash tints up with white and Tailwind
  // composes the alpha (bg-tint/5, bg-tint/10).
  state: {
    tint: '#FFFFFF',
    selected: 'rgba(227, 154, 168, 0.16)',
    disabledOpacity: '0.4',
  },
  edge: {
    highlight: 'rgba(232, 223, 214, 0.09)',
    shadow: 'rgba(0, 0, 0, 0.45)',
  },
  bevel: {
    outer: '0 10px 30px rgba(0, 0, 0, 0.5)',
    inner: 'inset 0 1px 0 rgba(232, 223, 214, 0.06)',
    pressed: 'inset 0 2px 6px rgba(0, 0, 0, 0.38)',
    cast: 'rgba(0, 0, 0, 0.45)',
  },
  sheen: {
    angle: '180deg',
    specular: 'rgba(232, 223, 214, 0.12)',
  },
  ambient: {
    layerOpacity: '1',
    layerBlend: 'normal',
    // 0, not -1: the petals fall *in front of* the UI, the way gothic's fog
    // sits above content. -1 is only for a skin whose ambient layer is its
    // ground, which requires a transparent surface.base (see aero).
    layerZ: '0',
  },
  focus: {
    glow: '0 0 0 3px rgba(196, 112, 126, 0.26)',
  },
  effect: {
    glow: '0 0 22px rgba(227, 154, 168, 0.30)',
    // The tooth of the paper. Low — washi is smooth in the hand; the visible
    // fibre is a separate directional layer in sakura.css, because grain.ts
    // generates isotropic noise and paper fibre runs one way.
    noiseOpacity: '0.035',
    texture: 'none',
  },
  // The sharpest corners of the four skins. Japanese editorial geometry is
  // square — the page is ruled, not rounded — and at 2/4/6 the difference from
  // aero's 5/9/13 is legible at a glance on the same button.
  radius: { sm: '2px', md: '4px', lg: '6px', pill: '999px' },
  // Note: nothing in the app reads --space-* today (padding comes from Tailwind
  // utilities, which are not theme-mapped), so these are declarative only. The
  // brief's "wide margins and vertical rhythm" is delivered typographically in
  // sakura.css instead — line-height, tracking, and ruled section headers.
  space: { xs: '8px', sm: '16px', md: '28px', lg: '40px', xl: '64px' },
  type: {
    // Shippori Mincho: a high-contrast serif whose Latin was drawn to sit
    // beside kanji, so display lines mixing the two hold one texture. Bundled
    // locally, subset to what the app renders — see fonts.css.
    display: "'Shippori Mincho', 'Shippori Mincho B1', 'Yu Mincho', 'Noto Serif JP', serif",
    body: "'Zen Kaku Gothic New', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
    mono: "'M PLUS 1 Code', 'Consolas', 'Yu Gothic UI', monospace",
    // Gothic sans, not mincho, for the kanji token specifically: it feeds small
    // functional labels, and mincho's thin horizontals disappear at 12px.
    // Mincho is for display, which is what type.display and type.seal are.
    kanji: "'Zen Kaku Gothic New', 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
    seal: "'Shippori Mincho', 'Shippori Mincho B1', 'Yu Mincho', serif",
    scale: { xs: '12px', sm: '14px', md: '16px', lg: '20px', xl: '28px', display: '44px' },
    weight: { normal: 400, medium: 500, bold: 700 },
    // The widest `wide` of the four skins. Japanese editorial display sets
    // letterspaced, and it is most of what separates this skin's headers from
    // Shingan's at the same size.
    tracking: { tight: '-0.01em', normal: '0', wide: '0.1em' },
  },
  // The calmest motion in the app. Nothing in a garden at night is in a hurry,
  // and the reveal and the petals both key off these.
  motion: {
    durationFast: '160ms',
    durationBase: '260ms',
    durationSlow: '420ms',
    easeStandard: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
  },
}
