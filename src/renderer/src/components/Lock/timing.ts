/**
 * Unlock reveal timing, in one place.
 *
 * These values were previously duplicated between LockScreen (which runs the
 * animation) and useVoiceAuth (which holds the state machine busy until it
 * finishes), kept in step by a comment. They are here instead so changing the
 * pacing is a one-line edit that cannot desynchronise the two.
 *
 * Why the reveal length matters beyond aesthetics: LockGate mounts the app
 * shell as soon as main reports the unlock, so the lock plate animates away
 * *over* an interface that is already mounting and fetching. A longer reveal
 * gives those panels more wall-clock time to paint before they are fully
 * visible, which is why this is slower than a transition would normally be.
 *
 * It buys time, it does not guarantee readiness — a slow network fetch will
 * still pop in afterwards. Gating the reveal on an actual readiness signal is
 * the fix for that, not a longer duration.
 */

/**
 * Scales every duration below. 1 is the original snappy pacing; 3 is the
 * current deliberate slow reveal. Adjust this rather than the numbers.
 */
export const UNLOCK_SPEED_SCALE = 3

/** Pacing at scale 1, before UNLOCK_SPEED_SCALE is applied. */
const BASE_MS = {
  /** Lock plate scaling up and fading out — the reveal proper. */
  reveal: 900,
  /** Scan-line sweep down the screen on success. */
  scanline: 750,
  /** Chromatic-aberration settle on the wordmark. */
  aberration: 500,
  /** Reduced-motion replacement for the reveal: a plain fade. */
  reducedFade: 250,
} as const

export const UNLOCK_TIMING = {
  revealMs: BASE_MS.reveal * UNLOCK_SPEED_SCALE,
  scanlineMs: BASE_MS.scanline * UNLOCK_SPEED_SCALE,
  aberrationMs: BASE_MS.aberration * UNLOCK_SPEED_SCALE,
  reducedFadeMs: BASE_MS.reducedFade * UNLOCK_SPEED_SCALE,
} as const

/** Seconds, for Framer Motion's transition objects. */
export const UNLOCK_SECONDS = {
  reveal: UNLOCK_TIMING.revealMs / 1000,
  scanline: UNLOCK_TIMING.scanlineMs / 1000,
  aberration: UNLOCK_TIMING.aberrationMs / 1000,
  reducedFade: UNLOCK_TIMING.reducedFadeMs / 1000,
} as const
