import { ParticleSwarmOrb, type ComputeTargetContext, type ParticleTarget } from './ParticleSwarmOrb'

// Ported from "sphere.html" (particle swarm export) — a Fibonacci-sphere
// shell. The source shape has no motion of its own (only the camera
// auto-rotates); a self-rotation plus per-particle shimmer are layered on so
// it stays visibly alive at rest and visibly "spins up" on state changes —
// `time` here is already scaled by the current state's speed multiplier
// (see ParticleSwarmOrb), same mechanism ReiganOrb uses for its swirl speed.
const SAT = 0.9
const LIGHT = 0.5
const RADIUS = 30
const ROTATION_RATE = 0.15

export class SphereOrb extends ParticleSwarmOrb {
  protected computeTarget({ i, count, time, audio, audioInfluence, stateHue }: ComputeTargetContext): ParticleTarget {
    const phi = Math.acos(-1 + (2 * i) / count)
    const theta = Math.sqrt(count * Math.PI) * phi

    const phase = i * 0.31
    const idleShimmer = 0.025 * Math.sin(time * 0.7 + phase)
    const voicedBreath = audio.amplitude * 0.06 * audioInfluence
    const r = RADIUS * (1 + idleShimmer + voicedBreath)

    const x0 = r * Math.cos(theta) * Math.sin(phi)
    const z0 = r * Math.sin(theta) * Math.sin(phi)

    // Self-rotation around Y — speeds up/slows down with state, the same
    // "spin up" mechanism ReiganOrb's rotationRate param drives.
    const angle = time * ROTATION_RATE
    const cA = Math.cos(angle)
    const sA = Math.sin(angle)

    return {
      x: x0 * cA - z0 * sA,
      y: r * Math.cos(phi),
      z: x0 * sA + z0 * cA,
      h: stateHue,
      s: SAT,
      l: LIGHT + idleShimmer,
    }
  }
}
