import { lazy } from 'react'
import type { Theme } from './types'
import { shinganTokens } from './themes/shingan/tokens'
import { gothicTokens } from './themes/gothic/tokens'
import { aeroTokens } from './themes/aero/tokens'
import { sakuraTokens } from './themes/sakura/tokens'
import { roseWindow } from './themes/gothic/roseWindow'
import { ornateFrame } from './themes/gothic/frame'
import { inkBranch } from './themes/sakura/branch'

/**
 * Every theme the app knows about. This is the only place that knows all
 * themes exist — to add one, drop a new folder under themes/ (tokens.ts +
 * Effects.tsx following the gothic shape) and add one entry here.
 */
export const THEMES = {
  shingan: {
    id: 'shingan',
    name: 'Shingan',
    description: 'Hanko seal, ink-void black, shu vermillion — the default eye.',
    colorScheme: 'dark',
    tokens: shinganTokens,
    // 26 is the spark pool the region field is written against (arcs are
    // scheduled separately and never number more than four); 60fps because a
    // discharge lives ~200ms and at 30 it would read as three stills.
    motionProfile: { maxParticles: 26, targetFps: 60, pauseOnBlur: true },
    // Brush-stroke ink: each glyph lands with a short vertical settle.
    textReveal: { animation: 'reveal-ink', unit: 'char', durationMs: 200, staggerMs: 9, maxDelayMs: 160 },
    Effects: lazy(() => import('./themes/shingan/Effects')),
    particles: () => import('./themes/shingan/field'),
    previewGradient: 'linear-gradient(135deg, #D8432A 0%, #C9A227 100%)',
  },
  gothic: {
    id: 'gothic',
    name: 'Sepulchral',
    description: 'Victorian mourning — oxblood, tarnished silver, engraved silhouette.',
    colorScheme: 'dark',
    tokens: gothicTokens,
    motionProfile: { maxParticles: 40, targetFps: 30, pauseOnBlur: true },
    // Chisel: each glyph is cut in word by word, slower and heavier than ink.
    textReveal: { animation: 'reveal-chisel', unit: 'word', durationMs: 380, staggerMs: 46, maxDelayMs: 520 },
    watermark: roseWindow,
    frame: ornateFrame,
    Effects: lazy(() => import('./themes/gothic/Effects')),
    particles: () => import('./themes/gothic/field'),
    previewGradient: 'linear-gradient(135deg, #6E1423 0%, #3B4252 100%)',
  },
  aero: {
    id: 'aero',
    name: 'Frutiger Aero',
    description: 'Vista glass, aqua depth, lime garnish — 2007 on a good day.',
    colorScheme: 'light',
    tokens: aeroTokens,
    // 40 is the bubble cap the ambient layer is written against; targetFps 60
    // because the whole layer is compositor-driven CSS with no RAF loop to
    // throttle in the first place.
    motionProfile: { maxParticles: 40, targetFps: 60, pauseOnBlur: true },
    // Gloss: letters surface one at a time with a quick wet rise, faster and
    // lighter than either the ink settle or the chisel.
    textReveal: { animation: 'reveal-gloss', unit: 'char', durationMs: 240, staggerMs: 11, maxDelayMs: 190 },
    Effects: lazy(() => import('./themes/aero/Effects')),
    // No `particles` entry, and deliberately so. Aero's bubbles already rise
    // behind every surface — its ambient layer *is* the ground (layerZ -1) and
    // its panels are glass — and they run entirely on the compositor with no
    // RAF loop at all. Re-cutting them as per-region canvases would put the
    // same bubbles on the main thread twice over to fix a stacking problem this
    // skin does not have.
    previewGradient: 'linear-gradient(135deg, #BFE9FF 0%, #16A8D8 55%, #063E56 100%)',
  },
  sakura: {
    id: 'sakura',
    name: 'Yozakura',
    description: 'Night hanami — plum-black garden, lantern rose, petals that read the room.',
    colorScheme: 'dark',
    tokens: sakuraTokens,
    // 28 petals is the pool the ambient layer is written against; 60fps because
    // the canvas loop integrates real physics per petal and halving the rate
    // makes the flutter stutter, where gothic's drifting fog survives 30.
    motionProfile: { maxParticles: 28, targetFps: 60, pauseOnBlur: true },
    // Settle: each glyph arrives slightly high and tilted, then lands — a petal
    // touching down. Slower than ink, lighter than chisel, calmer than gloss.
    textReveal: { animation: 'reveal-settle', unit: 'char', durationMs: 300, staggerMs: 12, maxDelayMs: 200 },
    watermark: inkBranch,
    Effects: lazy(() => import('./themes/sakura/Effects')),
    particles: () => import('./themes/sakura/field'),
    previewGradient: 'linear-gradient(135deg, #1E1B24 0%, #C4707E 55%, #E39AA8 100%)',
  },
} satisfies Record<string, Theme>

export type ThemeId = keyof typeof THEMES

export const DEFAULT_THEME_ID: ThemeId = 'shingan'

export function isThemeId(value: string | undefined | null): value is ThemeId {
  return !!value && value in THEMES
}
