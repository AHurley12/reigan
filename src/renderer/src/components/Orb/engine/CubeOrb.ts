import { ParticleSwarmOrb, type ComputeTargetContext, type ParticleTarget } from './ParticleSwarmOrb'

// Ported from "cube.html" (particle swarm export) — a cubic lattice
// formation. The source shape has no motion of its own (only the camera
// auto-rotates); a self-rotation plus per-particle shimmer are layered on so
// it stays visibly alive at rest and visibly "spins up" on state changes —
// `time` here is already scaled by the current state's speed multiplier
// (see ParticleSwarmOrb), same mechanism ReiganOrb uses for its swirl speed.
const SAT = 0.9
const LIGHT = 0.5
const ROTATION_RATE = 0.15

export class CubeOrb extends ParticleSwarmOrb {
  protected computeTarget({ i, count, time, audio, audioInfluence, stateHue }: ComputeTargetContext): ParticleTarget {
    const side = Math.ceil(Math.pow(count, 1 / 3))
    const sep = 2.5
    const off = (side * sep) / 2

    const z0 = Math.floor(i / (side * side)) * sep - off
    const y = Math.floor((i % (side * side)) / side) * sep - off
    const x0 = (i % side) * sep - off

    // Self-rotation around Y — speeds up/slows down with state, the same
    // "spin up" mechanism ReiganOrb's rotationRate param drives.
    const angle = time * ROTATION_RATE
    const cA = Math.cos(angle)
    const sA = Math.sin(angle)
    const x = x0 * cA - z0 * sA
    const z = x0 * sA + z0 * cA

    // Idle shimmer: each particle breathes on its own phase, plus a stronger
    // uniform pulse while listening/speaking.
    const phase = i * 0.7
    const idleShimmer = 0.02 * Math.sin(time * 0.6 + phase)
    const voicedBreath = audio.amplitude * 0.06 * audioInfluence
    const breath = 1 + idleShimmer + voicedBreath

    return {
      x: x * breath,
      y: y * breath,
      z: z * breath,
      h: stateHue,
      s: SAT,
      l: LIGHT + idleShimmer,
    }
  }
}
