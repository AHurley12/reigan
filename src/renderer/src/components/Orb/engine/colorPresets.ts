import type { OrbState, StatePreset } from './types'

export const STATE_PRESETS: Record<OrbState, StatePreset> = {
  idle: {
    speedMult: 0.6,
    params: { nebulaSize: 26, petalCurl: 1.15, rotationRate: 0.2, cloudDepth: 3.4, corePulse: 0.5, turbulence: 0.4 },
    colors: { petalHueBase: 0.77, petalHueRange: 0.05, coreHueBase: 0.54, coreHueRange: 0.03, haloHueBase: 0.72, haloHueRange: 0.06 },
  },
  listening: {
    speedMult: 1.0,
    params: { nebulaSize: 32, petalCurl: 1.15, rotationRate: 0.35, cloudDepth: 3.4, corePulse: 0.8, turbulence: 0.7 },
    colors: { petalHueBase: 0.52, petalHueRange: 0.06, coreHueBase: 0.50, coreHueRange: 0.04, haloHueBase: 0.68, haloHueRange: 0.08 },
  },
  processing: {
    speedMult: 1.8,
    params: { nebulaSize: 24, petalCurl: 1.4, rotationRate: 0.9, cloudDepth: 2.5, corePulse: 1.8, turbulence: 1.2 },
    colors: { petalHueBase: 0.78, petalHueRange: 0.04, coreHueBase: 0.56, coreHueRange: 0.02, haloHueBase: 0.74, haloHueRange: 0.04 },
  },
  speaking: {
    speedMult: 1.0,
    params: { nebulaSize: 30, petalCurl: 1.15, rotationRate: 0.32, cloudDepth: 3.4, corePulse: 0.75, turbulence: 0.6 },
    colors: { petalHueBase: 0.75, petalHueRange: 0.05, coreHueBase: 0.53, coreHueRange: 0.03, haloHueBase: 0.70, haloHueRange: 0.06 },
  },
  error: {
    speedMult: 0.4,
    params: { nebulaSize: 20, petalCurl: 0.8, rotationRate: 0.1, cloudDepth: 2.0, corePulse: 0.3, turbulence: 1.5 },
    colors: { petalHueBase: 0.0, petalHueRange: 0.03, coreHueBase: 0.02, coreHueRange: 0.02, haloHueBase: 0.98, haloHueRange: 0.04 },
  },
  success: {
    speedMult: 1.2,
    params: { nebulaSize: 34, petalCurl: 1.0, rotationRate: 0.5, cloudDepth: 3.0, corePulse: 1.0, turbulence: 0.3 },
    colors: { petalHueBase: 0.35, petalHueRange: 0.05, coreHueBase: 0.38, coreHueRange: 0.03, haloHueBase: 0.32, haloHueRange: 0.06 },
  },
}
