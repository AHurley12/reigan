import { ParticleSwarmOrb, type ComputeTargetContext, type ParticleTarget } from './ParticleSwarmOrb'

// Ported from "helix.html" (particle swarm export) — a double-turn helix.
// The source shape is otherwise static once formed (only the camera
// auto-rotates); a continuous self-rotation is layered on so it stays
// visibly alive at rest, matching ReiganOrb's continuous motion. Color keeps
// the source's rainbow sweep along the strand, but recentered on the current
// REIGAN state's hue instead of running across the full spectrum, so the
// strand still reads as "listening" (jade-centered) vs. "error" (red-centered).
const RADIUS = 15
const HUE_SPAN = 0.4

export class HelixOrb extends ParticleSwarmOrb {
  protected computeTarget({ i, count, time, audio, audioInfluence, stateHue }: ComputeTargetContext): ParticleTarget {
    const height = count * 0.003
    const off = height / 2
    // Continuous self-rotation on top of the per-particle winding, so the
    // strand keeps twisting even when the camera isn't orbiting.
    const turn = i * 0.05 + time * 0.3

    const voicedBreath = audio.amplitude * 0.06 * audioInfluence
    const r = RADIUS * (1 + voicedBreath)

    return {
      x: Math.cos(turn) * r,
      y: i * 0.003 - off,
      z: Math.sin(turn) * r,
      h: stateHue + (i / count - 0.5) * HUE_SPAN,
      s: 1,
      l: 0.5,
    }
  }
}
