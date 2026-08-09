import { useMemo } from 'react'
import type { EffectsProps } from '../../types'
import './ambient.css'

/**
 * Frutiger Aero ambient layer — the ground the whole skin sits on, rather than
 * an overlay floating above it (see tokens.ts: ambient.layerZ is -1 and every
 * surface above is glass).
 *
 * Driven entirely by CSS animations, with no requestAnimationFrame loop at
 * all. That is the single biggest perf decision here: the Sepulchral layer
 * runs a canvas RAF loop that repaints every mote every frame on the main
 * thread, and Aero is a heavier composition. Declarative transform/opacity
 * animations hand the whole thing to the compositor, so the main thread stays
 * free for the app and an idle window costs nothing measurable.
 */

/** Hard ceiling from the perf budget. The pool never exceeds this. */
const MAX_BUBBLES = 40
const BUBBLE_COUNT = 34

/**
 * Deterministic, so the composition is identical on every mount and a
 * re-render never reshuffles the scene. mulberry32.
 */
function makeRandom(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A bubble: a rim-lit sphere with a specular arc in the upper left. Authored
 * SVG, carried as a data URI on a div's background rather than as a live SVG
 * node — a div with a background composites on the GPU, where an animated
 * <g transform> in SVG generally does not, and the perf budget outranks the
 * choice of element.
 */
function bubbleImage(alpha: number): string {
  const a = (base: number) => (base * alpha).toFixed(3)
  const svg =
    `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E` +
    `%3Cdefs%3E%3CradialGradient id='b' cx='38%25' cy='32%25' r='70%25'%3E` +
    `%3Cstop offset='0%25' stop-color='%23ffffff' stop-opacity='${a(0.28)}'/%3E` +
    `%3Cstop offset='58%25' stop-color='%23bfe9ff' stop-opacity='${a(0.1)}'/%3E` +
    `%3Cstop offset='100%25' stop-color='%23ffffff' stop-opacity='${a(0.52)}'/%3E` +
    `%3C/radialGradient%3E%3C/defs%3E` +
    `%3Ccircle cx='20' cy='20' r='19' fill='url(%23b)'/%3E` +
    `%3Ccircle cx='20' cy='20' r='19' fill='none' stroke='%23ffffff' stroke-opacity='${a(0.6)}' stroke-width='0.9'/%3E` +
    `%3Cpath d='M9.5 14.5A13 13 0 0 1 17.5 8' fill='none' stroke='%23ffffff' stroke-opacity='${a(0.92)}' stroke-width='2.4' stroke-linecap='round'/%3E` +
    `%3C/svg%3E`
  return `url("data:image/svg+xml,${svg}")`
}

/**
 * Five alpha steps, shared across the pool. Peak brightness has to be baked
 * into the image rather than animated to a per-bubble opacity, because a
 * var() in a keyframe takes the whole animation off the compositor — see
 * ambient.css. Five distinct data URIs is a cheap price for that.
 */
const ALPHA_STEPS = [0.45, 0.6, 0.75, 0.88, 1] as const
const PATHS = 4

interface Bubble {
  left: number
  size: number
  duration: number
  delay: number
  path: number
  alpha: number
}

function makeBubbles(count: number): Bubble[] {
  const random = makeRandom(0x5eed)
  return Array.from({ length: Math.min(count, MAX_BUBBLES) }, () => {
    const duration = 16 + random() * 26
    return {
      left: random() * 100,
      // Sized generously because almost every bubble is seen *through* a
      // frosted panel — the app's own layout covers most of the window. Small
      // faint ones simply do not survive a 9px backdrop blur.
      size: 10 + random() * 46,
      duration,
      // Negative, and spread across a full cycle, so the pool is already
      // distributed up the frame at t=0 instead of every bubble launching at
      // the bottom together. This is also what makes the paused state a
      // composition rather than a row of dots.
      delay: -random() * duration,
      path: 1 + Math.floor(random() * PATHS),
      alpha: ALPHA_STEPS[Math.floor(random() * ALPHA_STEPS.length)],
    }
  })
}

/*
 * No grass/leaf silhouette. It was built, rendered, and cut after looking at
 * it: this app's panels cover the bottom of the window edge to edge (chat
 * input bar, orb column, nav rail), so a band along the bottom of the ambient
 * layer has no exposed real estate to be seen in — behind 30% white and a 9px
 * blur it produced nothing but a faint darkening. An invisible element that
 * still costs a raster is worse than no element.
 */

export default function AeroEffects({ reducedMotion, paused }: EffectsProps) {
  const bubbles = useMemo(() => makeBubbles(BUBBLE_COUNT), [])
  const images = useMemo(() => ALPHA_STEPS.map(bubbleImage), [])
  const still = reducedMotion || paused

  return (
    <div className={`aero-ambient${still ? ' aero-ambient--still' : ''}`} aria-hidden>
      <div className="aero-caustic aero-caustic--a" />
      <div className="aero-caustic aero-caustic--b" />
      <div className="aero-bloom" />

      {bubbles.map((b, i) => (
        <div
          key={i}
          className="aero-bubble"
          style={{
            left: `${b.left}%`,
            width: b.size,
            height: b.size,
            backgroundImage: images[ALPHA_STEPS.indexOf(b.alpha as (typeof ALPHA_STEPS)[number])],
            animationName: `aero-rise-${b.path}`,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  )
}
