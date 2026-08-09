import type { ComponentType, LazyExoticComponent } from 'react'

export interface ThemeTokens {
  surface: {
    base: string
    raised: string
    overlay: string
    sunken: string
    scrim: string
    /** Top stop of a glass panel's gloss gradient. */
    glossTop: string
    /** Bottom stop of the same gradient. */
    glossBottom: string
    /** The translucent fill of a glass surface, painted under the blur. */
    glassTint: string
    /** backdrop-filter radius. Budgeted — see SKIN_CONTRACT §Perf. */
    glassBlur: string
  }
  text: {
    primary: string
    secondary: string
    muted: string
    inverse: string
    accent: string
    /** Japanese label text, which runs quieter than body copy. */
    kanji: string
    /** Text sitting on an accent fill (buttons). Not the same as `inverse`,
        which is text on a plain light surface. */
    onAccent: string
    /** Text that has to survive a bright translucent background. */
    onGlass: string
  }
  accent: {
    primary: string
    secondary: string
    danger: string
    success: string
    /**
     * Fill for the app's primary action buttons. A token rather than a derived
     * alias because applyTokens writes the legacy names as *inline* styles on
     * <html>, which no stylesheet rule can override — so a skin that wants a
     * glossy button instead of a two-stop ramp has to say so here.
     */
    gradient: string
  }
  border: {
    subtle: string
    strong: string
    focus: string
  }
  /**
   * Interaction wash. `tint` is a *solid* colour that Tailwind composes alpha
   * onto (`bg-tint/5`, `bg-tint/10`), which is why hover states can be one
   * token instead of one per opacity step. Dark skins tint with white; a light
   * skin has to tint with its own dark ink or hover reads as nothing at all.
   */
  state: {
    tint: string
    /** Background of a selected chip / active tab. */
    selected: string
    disabledOpacity: string
  }
  /** 1px inner lines that give a surface its lit top and shaded underside. */
  edge: {
    highlight: string
    shadow: string
  }
  /** Whole-element depth: outer for lifted, inner for recessed. */
  bevel: {
    /** Complete shadow for a floating overlay (dropdown, toast, tooltip). */
    outer: string
    inner: string
    /** Outer shadow while an element is pressed. */
    pressed: string
    /**
     * Raw shadow tint, for the few components that must supply their own
     * offsets — a right-edge drawer casts left, which no single complete
     * shadow string can express. Geometry stays with the component; only the
     * colour is the skin's business.
     */
    cast: string
  }
  /** Direction of gloss/specular gradients, so sheen is skin-controlled. */
  sheen: {
    angle: string
    /** Specular band colour on a gloss button. */
    specular: string
  }
  /** The ambient effects layer's compositing, independent of its content. */
  ambient: {
    layerOpacity: string
    layerBlend: string
    /**
     * Stacking of the ambient layer. `0` puts it above in-flow content, which
     * is what a sparse dark overlay (fog, embers, vignette) wants. `-1` puts it
     * behind everything, which is what a bright full-bleed ground needs — and
     * requires the skin's surfaces to be translucent, or nothing shows.
     */
    layerZ: string
  }
  focus: {
    /** box-shadow applied on :focus-visible, on top of the outline. */
    glow: string
  }
  effect: {
    glow: string
    noiseOpacity: string
    texture: string
  }
  radius: { sm: string; md: string; lg: string; pill: string }
  space: { xs: string; sm: string; md: string; lg: string; xl: string }
  type: {
    display: string
    body: string
    mono: string
    /** Japanese text. Kept separate so a theme can pair mincho with a serif
        Latin face without dragging the whole body stack along. */
    kanji: string
    /** The hanko / seal mark and other display-only lettering. */
    seal: string
    scale: { xs: string; sm: string; md: string; lg: string; xl: string; display: string }
    weight: { normal: number; medium: number; bold: number }
    tracking: { tight: string; normal: string; wide: string }
  }
  motion: {
    durationFast: string
    durationBase: string
    durationSlow: string
    easeStandard: string
    easeEnter: string
    easeExit: string
  }
}

export interface MotionProfile {
  /** Hard ceiling the effects layer must respect. */
  maxParticles: number
  targetFps: 30 | 60
  /** If true, effects pause entirely when window loses focus. */
  pauseOnBlur: boolean
}

export interface EffectsProps {
  reducedMotion: boolean
  paused: boolean
}

/**
 * How assistant text arrives on screen. Owned by the theme, not by the chat
 * component — swapping the reveal is a token change, never a code change.
 *
 * `animation` names a @keyframes the theme's own CSS defines; nothing here
 * knows what it looks like. `unit: 'none'` skips the split entirely and lets
 * text render plainly, which is also the reduced-motion fallback.
 */
export interface TextReveal {
  animation: string
  unit: 'char' | 'word' | 'none'
  durationMs: number
  /** Per-unit delay increment. */
  staggerMs: number
  /** Ceiling on accumulated delay so long messages don't queue seconds of lag. */
  maxDelayMs: number
}

/**
 * A decorative containment border, carried as a nine-slice border image so a
 * fixed-size corner ornament can sit on boxes of any dimension without
 * distorting. The theme owns the artwork; components only mark which boxes
 * are "contained" (.ornate) by adding the class.
 */
export interface ThemeFrame {
  /** border-image-source at rest. */
  base: string
  /** border-image-source while the box holds focus. */
  focus: string
  /** Corner tile size in px — feeds border-image-slice and -width. */
  slice: number
}

export interface Theme {
  /** Matches the key this theme is registered under in registry.ts. */
  id: string
  name: string
  description: string
  colorScheme: 'dark' | 'light'
  tokens: ThemeTokens
  motionProfile: MotionProfile
  /** How streamed assistant text is revealed. See TextReveal. */
  textReveal: TextReveal
  /**
   * Optional still watermark painted behind the chat surface. Returns a CSS
   * background-image value (typically a data-URI). A function rather than a
   * string so a theme can generate it lazily and cache — nothing is built
   * for themes the user never selects.
   */
  watermark?: () => string
  /**
   * Optional ornate border for framed containers (.ornate). Same lazy-function
   * shape as watermark, for the same reason. Themes that omit it fall back to
   * the plain hairline the class already declares.
   */
  frame?: () => ThemeFrame
  /** Lazy-loaded ambient layer. Must be pure visual, pointer-events: none. */
  Effects: LazyExoticComponent<ComponentType<EffectsProps>>
  /** Static preview swatch for the selector — no animation, cheap to render. */
  previewGradient: string
}
