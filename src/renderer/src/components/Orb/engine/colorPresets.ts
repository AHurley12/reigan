import type { OrbState, StatePreset, ColorShift } from './types'
import { hueOf } from './colorMath'

/**
 * Orb state presets, split into a skin-independent half and a skin-derived one.
 *
 * Until 2026-08-08 this file was a flat constant of hue numbers whose own
 * comment read "retuned to the Shingan palette" — so the orb rendered
 * vermillion/jade/gold under *every* skin, Sepulchral included. There was no
 * API for a theme to influence it at all.
 *
 * Now: motion (speed, size, turbulence) is shared, because how the orb *moves*
 * is the orb's identity and not the skin's business. Hue is derived from the
 * active theme's accent tokens, so a new skin gets a correct orb for free and
 * nothing has to be hand-tuned per skin.
 */

/** Which token each state takes its hue from. Semantics, not colours. */
export type OrbHueSource = 'muted' | 'secondary' | 'primary' | 'accent' | 'danger' | 'success'

/**
 * The parts of a state that belong to the orb, not the skin. `coreOffset` and
 * `haloOffset` are the hue relationships the original hand-tuned presets had
 * between the three particle layers; preserving them is what keeps the orb
 * looking like itself once the base hue moves.
 */
interface OrbMotion {
  speedMult: number
  params: StatePreset['params']
  hueFrom: OrbHueSource
  coreOffset: number
  haloOffset: number
  petalRange: number
  coreRange: number
  haloRange: number
}

const MOTION: Record<OrbState, OrbMotion> = {
  idle: {
    speedMult: 0.6,
    params: { nebulaSize: 26, petalCurl: 1.15, rotationRate: 0.2, cloudDepth: 3.4, corePulse: 0.5, turbulence: 0.4 },
    hueFrom: 'muted', coreOffset: -0.01, haloOffset: 0.01, petalRange: 0.04, coreRange: 0.03, haloRange: 0.05,
  },
  listening: {
    speedMult: 1.0,
    params: { nebulaSize: 32, petalCurl: 1.15, rotationRate: 0.35, cloudDepth: 3.4, corePulse: 0.8, turbulence: 0.7 },
    hueFrom: 'secondary', coreOffset: -0.01, haloOffset: 0.03, petalRange: 0.05, coreRange: 0.03, haloRange: 0.06,
  },
  processing: {
    speedMult: 1.8,
    params: { nebulaSize: 24, petalCurl: 1.4, rotationRate: 0.9, cloudDepth: 2.5, corePulse: 1.8, turbulence: 1.2 },
    hueFrom: 'primary', coreOffset: 0, haloOffset: 0.02, petalRange: 0.03, coreRange: 0.02, haloRange: 0.04,
  },
  speaking: {
    speedMult: 1.0,
    params: { nebulaSize: 30, petalCurl: 1.15, rotationRate: 0.32, cloudDepth: 3.4, corePulse: 0.75, turbulence: 0.6 },
    hueFrom: 'accent', coreOffset: -0.01, haloOffset: 0.02, petalRange: 0.05, coreRange: 0.03, haloRange: 0.06,
  },
  error: {
    speedMult: 0.4,
    params: { nebulaSize: 20, petalCurl: 0.8, rotationRate: 0.1, cloudDepth: 2.0, corePulse: 0.3, turbulence: 1.5 },
    hueFrom: 'danger', coreOffset: 0, haloOffset: -0.01, petalRange: 0.02, coreRange: 0.02, haloRange: 0.03,
  },
  success: {
    speedMult: 1.2,
    params: { nebulaSize: 34, petalCurl: 1.0, rotationRate: 0.5, cloudDepth: 3.0, corePulse: 1.0, turbulence: 0.3 },
    hueFrom: 'success', coreOffset: -0.02, haloOffset: 0.02, petalRange: 0.05, coreRange: 0.03, haloRange: 0.06,
  },
}

/** The hues the presets carry before any theme has been applied. */
const FALLBACK_HUES: Record<OrbHueSource, number> = {
  muted: 0.09, secondary: 0.47, primary: 0.02, accent: 0.13, danger: 0.99, success: 0.42,
}

function wrap(hue: number): number {
  return hue - Math.floor(hue)
}

function shift(motion: OrbMotion, base: number): ColorShift {
  return {
    petalHueBase: wrap(base),
    petalHueRange: motion.petalRange,
    coreHueBase: wrap(base + motion.coreOffset),
    coreHueRange: motion.coreRange,
    haloHueBase: wrap(base + motion.haloOffset),
    haloHueRange: motion.haloRange,
  }
}

function build(hues: Record<OrbHueSource, number>): Record<OrbState, StatePreset> {
  const out = {} as Record<OrbState, StatePreset>
  for (const state of Object.keys(MOTION) as OrbState[]) {
    const motion = MOTION[state]
    out[state] = { params: motion.params, speedMult: motion.speedMult, colors: shift(motion, hues[motion.hueFrom]) }
  }
  return out
}

/**
 * Mutated in place by applyOrbPalette rather than reassigned: all five orb
 * engines captured this binding at import time, and the two that read it
 * (ReiganOrb, ParticleSwarmOrb — the other three derive from the latter's
 * stateHue) look it up fresh on every setState. Mutating means one function
 * repalettes every orb style with no change to the engine interface.
 */
export const STATE_PRESETS: Record<OrbState, StatePreset> = build(FALLBACK_HUES)

/** Colour source for the orb. Structural subset of ThemeTokens. */
export interface OrbPaletteSource {
  text: { muted: string; accent: string }
  accent: { primary: string; secondary: string; danger: string; success: string }
}

/** Re-derives every state's hue from the active theme. Call on theme change. */
export function applyOrbPalette(tokens: OrbPaletteSource): void {
  const hues: Record<OrbHueSource, number> = {
    muted: hueOf(tokens.text.muted) ?? FALLBACK_HUES.muted,
    secondary: hueOf(tokens.accent.secondary) ?? FALLBACK_HUES.secondary,
    primary: hueOf(tokens.accent.primary) ?? FALLBACK_HUES.primary,
    accent: hueOf(tokens.text.accent) ?? FALLBACK_HUES.accent,
    danger: hueOf(tokens.accent.danger) ?? FALLBACK_HUES.danger,
    success: hueOf(tokens.accent.success) ?? FALLBACK_HUES.success,
  }
  const next = build(hues)
  for (const state of Object.keys(next) as OrbState[]) {
    STATE_PRESETS[state].colors = next[state].colors
  }
}
