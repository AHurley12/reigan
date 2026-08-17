import type { ReiganState } from '../../../../shared/types'

/**
 * The two boxes a theme may paint particles into. Deliberately not "any
 * element": these are the app's two large quiet grounds, and every other
 * region (the orb column, the title bar, the input bar) is either too busy or
 * too small for a field to read as anything but noise.
 */
export type RegionId = 'nav' | 'main'

export interface FieldInit {
  region: RegionId
  /** CSS px, not device px — the host has already applied the DPR transform. */
  width: number
  height: number
  /** motionProfile.maxParticles for the active theme. A hard ceiling. */
  maxParticles: number
}

/**
 * A theme's particle behaviour for one region, with no React, no canvas
 * lifecycle and no scheduling in it — the host owns all three. A field only
 * knows how to advance itself and how to paint itself.
 */
export interface ParticleField {
  /** The region box changed. Fields rescale in place; they never re-seed. */
  resize(width: number, height: number): void
  /**
   * Advance by `dt` ms. `elapsed` is this field's own accumulated time, which
   * is what phase-driven motion should read rather than `performance.now()` —
   * a paused field must resume where it stopped, not where the wall clock got
   * to.
   */
  step(dt: number, elapsed: number, activity: ReiganState): void
  /** Paint. The host has already cleared the canvas. */
  draw(ctx: CanvasRenderingContext2D): void
}

export interface FieldModule {
  createField(init: FieldInit): ParticleField
}

/** Lazily imported so a theme's field never joins the startup chunk. */
export type FieldLoader = () => Promise<FieldModule>

/**
 * How much of the theme's particle budget a region may spend.
 *
 * The rail is 62px wide, so an area-proportional split would give it almost
 * nothing; these shares instead say what each box can carry before the field
 * stops reading as atmosphere and starts reading as weather. They sum to more
 * than 1 on purpose — both regions are never dense at once, because the field
 * count is also scaled by area below.
 */
export function regionBudget(region: RegionId, maxParticles: number): number {
  const share = region === 'nav' ? 0.3 : 0.85
  return Math.max(1, Math.round(maxParticles * share))
}

/**
 * Particle count for a box: proportional to its area, clamped to the region's
 * budget. `perMegapixel` is the density a theme is authored against.
 *
 * This is what makes the volume vary the way the brief asks — a maximised
 * window carries more than a narrow one, and the rail always carries less than
 * the chat — without any theme hardcoding a number that a resize invalidates.
 */
export function countForArea(
  width: number,
  height: number,
  perMegapixel: number,
  budget: number,
  min = 1
): number {
  const megapixels = (width * height) / 1_000_000
  return Math.max(min, Math.min(budget, Math.round(megapixels * perMegapixel)))
}
