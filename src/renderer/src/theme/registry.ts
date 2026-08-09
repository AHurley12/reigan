import { lazy } from 'react'
import type { Theme } from './types'
import { shinganTokens } from './themes/shingan/tokens'
import { gothicTokens } from './themes/gothic/tokens'
import { aeroTokens } from './themes/aero/tokens'
import { roseWindow } from './themes/gothic/roseWindow'
import { ornateFrame } from './themes/gothic/frame'

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
    motionProfile: { maxParticles: 0, targetFps: 60, pauseOnBlur: true },
    // Brush-stroke ink: each glyph lands with a short vertical settle.
    textReveal: { animation: 'reveal-ink', unit: 'char', durationMs: 200, staggerMs: 9, maxDelayMs: 160 },
    Effects: lazy(() => import('./themes/shingan/Effects')),
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
    previewGradient: 'linear-gradient(135deg, #BFE9FF 0%, #16A8D8 55%, #063E56 100%)',
  },
} satisfies Record<string, Theme>

export type ThemeId = keyof typeof THEMES

export const DEFAULT_THEME_ID: ThemeId = 'shingan'

export function isThemeId(value: string | undefined | null): value is ThemeId {
  return !!value && value in THEMES
}
