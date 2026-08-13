import type { ReiganState } from '../../../../../shared/types'

/**
 * How the petal field reacts to what the assistant is doing — the pure part of
 * sakura's signature, split out from Effects.tsx so it can be tested without a
 * canvas or a React tree (same shape as Orb/engine/modelChoice.ts).
 *
 * `pull` is how strongly petals are drawn toward the chat surface; `calm`
 * scales overall speed. Both are *targets*: the layer eases toward them over
 * PULL_TAU rather than snapping, because a field that changed speed on the same
 * frame as the state reads as a glitch. Weather turns; it does not cut.
 */
export interface PetalResponse {
  /** 0 = drift freely, 1 = swirl toward the response area. */
  pull: number
  /** Speed multiplier. 1 is the resting rate. */
  calm: number
}

/** Time constant for easing toward a new response, in ms. */
export const PULL_TAU = 800

export function responseFor(activity: ReiganState): PetalResponse {
  switch (activity) {
    case 'processing':
      return { pull: 1, calm: 1 }
    case 'speaking':
      return { pull: 0.45, calm: 1 }
    case 'listening':
      // Nothing is being generated yet, so there is nowhere to pull toward —
      // the field just quickens slightly, like a held breath.
      return { pull: 0, calm: 1.25 }
    case 'error':
      // Stilled, not stopped. A layer frozen at exactly zero reads as a crash;
      // this reads as the air going out of the room.
      return { pull: 0, calm: 0.15 }
    default:
      return { pull: 0, calm: 1 }
  }
}

/**
 * Exponential approach toward `target`. Frame-rate independent — the same curve
 * whether it is stepped once at 32ms or twice at 16ms — which matters because
 * the layer is throttled to 60fps on a display that may run at 180.
 */
export function approach(current: number, target: number, dt: number, tau = PULL_TAU): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau))
}
