import type { MotionPreference } from '../../../shared/types'

/**
 * The pure part of the motion preference, split out of useReducedMotion so it
 * can be tested without a React tree or a media query (same shape as
 * theme/themes/sakura/petalResponse.ts).
 */

export function isMotionPreference(value: unknown): value is MotionPreference {
  return value === 'system' || value === 'reduce' || value === 'full'
}

/**
 * Resolves a stored preference against the OS one.
 *
 * The `full` branch is the one that matters: it never consults the system at
 * all. The setting this replaced was OR-ed with the media query, so on a
 * machine with "show animations" turned off the in-app control could not
 * un-reduce anything — it was inert, and every animation in the app was
 * unreachable with no indication why.
 */
export function resolveReducedMotion(
  preference: MotionPreference,
  systemPrefersReduce: boolean
): boolean {
  if (preference === 'reduce') return true
  if (preference === 'full') return false
  return systemPrefersReduce
}

/**
 * Coerces a persisted value to the tri-state. Rows written by an older build
 * carry `reducedMotion: boolean`, so someone who had opted into reduced motion
 * keeps that choice rather than silently losing an accessibility preference;
 * anything unrecognised falls back to following the system rather than to a
 * guess in either direction.
 */
export function normalizeMotion(value: unknown, legacyReducedMotion?: unknown): MotionPreference {
  if (isMotionPreference(value)) return value
  return legacyReducedMotion === true ? 'reduce' : 'system'
}
