import type { OrbState, StatePreset } from './types'

// Hues retuned to the Shingan palette: shu (vermillion, ~0.02), jade (~0.47),
// gold (~0.13) — replacing the old generic violet/cyan pairing.
export const STATE_PRESETS: Record<OrbState, StatePreset> = {
  idle: {
    speedMult: 0.6,
    params: { nebulaSize: 26, petalCurl: 1.15, rotationRate: 0.2, cloudDepth: 3.4, corePulse: 0.5, turbulence: 0.4 },
    colors: { petalHueBase: 0.09, petalHueRange: 0.04, coreHueBase: 0.08, coreHueRange: 0.03, haloHueBase: 0.10, haloHueRange: 0.05 },
  },
  listening: {
    speedMult: 1.0,
    params: { nebulaSize: 32, petalCurl: 1.15, rotationRate: 0.35, cloudDepth: 3.4, corePulse: 0.8, turbulence: 0.7 },
    colors: { petalHueBase: 0.47, petalHueRange: 0.05, coreHueBase: 0.46, coreHueRange: 0.03, haloHueBase: 0.50, haloHueRange: 0.06 },
  },
  processing: {
    speedMult: 1.8,
    params: { nebulaSize: 24, petalCurl: 1.4, rotationRate: 0.9, cloudDepth: 2.5, corePulse: 1.8, turbulence: 1.2 },
    colors: { petalHueBase: 0.02, petalHueRange: 0.03, coreHueBase: 0.02, coreHueRange: 0.02, haloHueBase: 0.04, haloHueRange: 0.04 },
  },
  speaking: {
    speedMult: 1.0,
    params: { nebulaSize: 30, petalCurl: 1.15, rotationRate: 0.32, cloudDepth: 3.4, corePulse: 0.75, turbulence: 0.6 },
    colors: { petalHueBase: 0.13, petalHueRange: 0.05, coreHueBase: 0.12, coreHueRange: 0.03, haloHueBase: 0.15, haloHueRange: 0.06 },
  },
  error: {
    speedMult: 0.4,
    params: { nebulaSize: 20, petalCurl: 0.8, rotationRate: 0.1, cloudDepth: 2.0, corePulse: 0.3, turbulence: 1.5 },
    colors: { petalHueBase: 0.99, petalHueRange: 0.02, coreHueBase: 0.99, coreHueRange: 0.02, haloHueBase: 0.98, haloHueRange: 0.03 },
  },
  success: {
    speedMult: 1.2,
    params: { nebulaSize: 34, petalCurl: 1.0, rotationRate: 0.5, cloudDepth: 3.0, corePulse: 1.0, turbulence: 0.3 },
    colors: { petalHueBase: 0.42, petalHueRange: 0.05, coreHueBase: 0.40, coreHueRange: 0.03, haloHueBase: 0.44, haloHueRange: 0.06 },
  },
}
