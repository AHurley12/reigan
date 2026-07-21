import type { ReiganState } from '../../../../../shared/types'

/**
 * REIGAN state drives visual behavior.
 * External systems (voice, chat) set the state; the orb responds.
 */
export type OrbState = ReiganState

/**
 * Tunable parameters exposed to external control.
 * Defaults are the Rose Nebula's original values.
 */
export interface OrbParams {
  nebulaSize: number // 12–48, default 30
  petalCurl: number // 0.2–2.4, default 1.15
  rotationRate: number // 0–1.5, default 0.32
  cloudDepth: number // 0.5–8, default 3.4
  corePulse: number // 0–2.5, default 0.75
  turbulence: number // 0–2, default 0.7
}

/**
 * Audio reactivity data fed from Web Audio API.
 */
export interface AudioData {
  amplitude: number // 0–1, overall volume level
  bass: number // 0–1, low frequency energy
  mid: number // 0–1, mid frequency energy
  high: number // 0–1, high frequency energy
}

export interface ColorShift {
  petalHueBase: number
  petalHueRange: number
  coreHueBase: number
  coreHueRange: number
  haloHueBase: number
  haloHueRange: number
}

export interface StatePreset {
  params: OrbParams
  speedMult: number
  colors: ColorShift
}
