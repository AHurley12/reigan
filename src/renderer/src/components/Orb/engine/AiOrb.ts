import { ParticleSwarmOrb, type ComputeTargetContext, type ParticleTarget } from './ParticleSwarmOrb'

// Ported from "ai_orb.html" (particle swarm export, "Glass Orb // Siri iOS 27")
// — an iridescent breathing sphere with internal curl-flow turbulence and a
// glass-shell/energy-core blend. Source PARAMS defaults preserved; turbulence
// and radius get a light audio-reactive boost on top, matching how ReiganOrb
// layers voice reactivity onto its base formula. The source's fixed hue
// anchor (0.52, cyan/blue) is replaced with the current REIGAN state's hue
// so the swirl still recolors per mode, same as every other orb style.
const BASE_RADIUS = 60
const FLOW = 0.8
const BASE_TURB = 0.45
const SHELL = 0.25
const HUE_SHIFT = 0.35
const GOLDEN_ANGLE = 2.399963229728653
const TAU = Math.PI * 2

export class AiOrb extends ParticleSwarmOrb {
  protected computeTarget({ i, count, time, audio, audioInfluence, stateHue }: ComputeTargetContext): ParticleTarget {
    const t = time * FLOW
    const turb = BASE_TURB + audio.amplitude * 0.5 * audioInfluence
    const radius = BASE_RADIUS * (1 + audio.bass * 0.15 * audioInfluence)

    const frac = (i + 0.5) / count
    const y0 = 1.0 - 2.0 * frac
    const r0 = Math.sqrt(Math.max(0.0, 1.0 - y0 * y0))
    const th = GOLDEN_ANGLE * i

    const x = r0 * Math.cos(th)
    const y = y0
    const z = r0 * Math.sin(th)

    // Layered sine "curl" turbulence — swirling energy ribbons inside the glass.
    const w1 = Math.sin(3.0 * x + t * 1.7 + Math.cos(2.0 * z - t)) * Math.cos(2.0 * y - t * 1.3)
    const w2 = Math.sin(4.0 * z - t * 1.1 + Math.cos(3.0 * x + t * 0.7)) * Math.cos(3.0 * y + t)
    const w3 = Math.sin(2.0 * y + t * 2.1 + Math.cos(4.0 * x - t * 0.5)) * Math.cos(2.0 * z + t * 0.9)

    // Gentle breathing of the whole orb.
    const breath = 1.0 + 0.06 * Math.sin(t * 1.2) + 0.03 * Math.sin(t * 2.7 + 1.3)

    // Two populations blended by pure math: outer glass shell + inner energy core.
    const band = 0.5 + 0.5 * Math.sin(frac * TAU * 3.0 + t * 0.6)
    const shellMix = band * SHELL

    // Radial modulation: shell particles hug the surface, core particles swirl deeper.
    const rMod = breath * (1.0 - shellMix * (0.55 + 0.35 * Math.sin(th * 0.5 + t)))
    const dist = turb * 0.22

    // Slow global rotation for that idle Siri drift.
    const rotA = t * 0.25
    const cA = Math.cos(rotA)
    const sA = Math.sin(rotA)
    const xr = x * cA - z * sA
    const zr = x * sA + z * cA

    const px = (xr + w1 * dist) * radius * rMod
    const py = (y + w2 * dist * 1.15) * radius * rMod
    const pz = (zr + w3 * dist) * radius * rMod

    // Iridescent glass palette flowing across the surface, recentered on the
    // current REIGAN state's hue instead of the source's fixed cyan/blue.
    const swirl = 0.5 + 0.5 * Math.sin(y * 2.0 + xr * 1.5 + t * 1.4 + w1 * 2.0)
    const hue = stateHue + HUE_SHIFT * 0.28 * swirl + 0.05 * Math.sin(t * 0.5 + frac * TAU)
    const edge = Math.abs(y0)
    const light = 0.55 + 0.25 * w2 * turb + 0.12 * edge
    const sat = 0.75 + 0.2 * swirl

    return { x: px, y: py, z: pz, h: hue, s: sat, l: light }
  }
}
