import { useEffect, useRef } from 'react'
import { useTheme } from '../useTheme'
import { useAppStore } from '../../stores/appStore'
import { useWindowPaused } from '../../hooks/useWindowPaused'
import { subscribeToFrames } from './driver'
import type { ParticleField, RegionId } from './types'
import type { ReiganState } from '../../../../shared/types'

/** dt is clamped to this so a backgrounded window can't integrate one huge step. */
const MAX_STEP_MS = 64

/**
 * Slack on the frame gate, in ms.
 *
 * A 60Hz display delivers frames about 16.66ms apart and a 60fps target asks
 * for 16.67. Gating on `dt < targetFrameMs` exactly therefore rejects most
 * frames and admits the one after, which halves the real rate and turns smooth
 * drift into judder — and it does so only on displays whose refresh matches the
 * target, which is the common case rather than an edge one. A little under a
 * frame of slack keeps the intended rate on every refresh rate.
 */
const FRAME_SLACK_MS = 1.5

/**
 * Paints the active theme's particle field into the region this sits in.
 *
 * The stacking is the whole point. A `z-index: -1` canvas inside a box that
 * establishes a stacking context (`.particle-host`) paints *after* that box's
 * own background and *before* every one of its children — so the field lands
 * on the chat ground and the rail rather than over them, and no icon, label,
 * caret or hover target is ever behind glass.
 *
 * The alternative the app already had is the full-viewport `EffectsLayer`,
 * which can only choose between floating over all content (`layerZ: 0`) or
 * sitting under it and being hidden by any opaque surface (`layerZ: -1`, which
 * is why only aero — whose surfaces are all glass — can use it). Neither can
 * put particles *inside* two specific opaque panels, which is what this does.
 *
 * The host owns every piece of lifecycle: device pixel ratio, measurement,
 * frame scheduling, throttling, the reduced-motion still frame and the blur
 * pause. A theme's field supplies only physics and paint.
 */
export function RegionParticles({ region }: { region: RegionId }) {
  const { theme, reducedMotion } = useTheme()
  const paused = useWindowPaused()
  const activity = useAppStore((s) => s.reiganState)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fieldRef = useRef<ParticleField | null>(null)
  const paintRef = useRef<(() => void) | null>(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const elapsedRef = useRef(0)
  const lastFrameRef = useRef<number | null>(null)
  // Held in a ref and deliberately not a dependency of the loop below: a new
  // assistant state must retarget the field, never tear it down and re-seed it.
  const activityRef = useRef<ReiganState>(activity)

  useEffect(() => {
    activityRef.current = activity
  }, [activity])

  const loader = theme.particles
  const { targetFps, pauseOnBlur, maxParticles } = theme.motionProfile
  const still = reducedMotion || (pauseOnBlur && paused)

  // Canvas, measurement and the field itself. Survives a pause — only a theme
  // swap or a region change rebuilds it.
  useEffect(() => {
    const canvas = canvasRef.current
    const host = canvas?.parentElement
    if (!loader || !canvas || !host) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Capped at 2: past that the backing store costs more fill than the
    // sharper particles are worth.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const measure = (): boolean => {
      const rect = host.getBoundingClientRect()
      const width = Math.max(1, Math.round(rect.width))
      const height = Math.max(1, Math.round(rect.height))
      if (width === sizeRef.current.width && height === sizeRef.current.height) return false
      sizeRef.current = { width, height }
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      // Assigning canvas.width resets the context, so the transform is
      // re-applied here rather than once at setup.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return true
    }

    const paint = () => {
      const field = fieldRef.current
      if (!field) return
      ctx.clearRect(0, 0, sizeRef.current.width, sizeRef.current.height)
      field.draw(ctx)
    }
    paintRef.current = paint

    measure()

    // ResizeObserver rather than a window resize listener: these boxes also
    // change when the orb column is toggled or the settings panel opens, and
    // neither fires a window resize.
    const observer = new ResizeObserver(() => {
      if (!measure()) return
      fieldRef.current?.resize(sizeRef.current.width, sizeRef.current.height)
      paint()
    })
    observer.observe(host)

    let cancelled = false
    loader().then((mod) => {
      if (cancelled) return
      fieldRef.current = mod.createField({
        region,
        width: sizeRef.current.width,
        height: sizeRef.current.height,
        maxParticles,
      })
      // Paints immediately, which is also the whole reduced-motion path: a
      // seeded field is a finished composition at t=0, never an empty box.
      paint()
    })

    return () => {
      cancelled = true
      observer.disconnect()
      ctx.clearRect(0, 0, sizeRef.current.width, sizeRef.current.height)
      fieldRef.current = null
      paintRef.current = null
      sizeRef.current = { width: 0, height: 0 }
      elapsedRef.current = 0
      lastFrameRef.current = null
    }
  }, [loader, region, maxParticles])

  // Frame subscription, split from setup so pausing on blur stops the loop and
  // leaves the last frame standing — a still composition, per the skin
  // contract, rather than a cleared canvas.
  useEffect(() => {
    if (!loader || still) return
    const targetFrameMs = 1000 / targetFps
    lastFrameRef.current = null

    return subscribeToFrames((now) => {
      const field = fieldRef.current
      const paint = paintRef.current
      if (!field || !paint) return

      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_STEP_MS)
      // Throttled to the theme's target rate: this app runs on a 180Hz
      // display, and without the gate the field would integrate and repaint
      // three times for every frame the user can actually see.
      if (dt < targetFrameMs - FRAME_SLACK_MS) return

      lastFrameRef.current = now
      elapsedRef.current += dt
      field.step(dt, elapsedRef.current, activityRef.current)
      paint()
    })
  }, [loader, still, targetFps])

  if (!loader) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        // The contract with .particle-host — see the note at the top.
        zIndex: -1,
        pointerEvents: 'none',
        // Rounds the field to the panel it sits in without the host having to
        // clip, which would cost the nav rail its tooltips (see globals.css).
        borderRadius: 'inherit',
      }}
    />
  )
}
