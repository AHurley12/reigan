import { useEffect, useRef } from 'react'
import type { EffectsProps } from '../../types'
import type { ReiganState } from '../../../../../shared/types'
import { responseFor, approach } from './petalResponse'

/**
 * Yozakura ambient layer — falling petals and low mist, on one RAF loop.
 *
 * This is the skin's signature, and the one place in the app where the ambient
 * layer is also UI: the petals report what the assistant is doing. At idle they
 * flutter down. While a response is generating they accelerate and swirl toward
 * the chat surface, so the drift itself points at where the answer is arriving.
 * On error they still, almost completely.
 *
 * Everything about that reaction is eased over ~800ms (see PULL_TAU). A petal
 * field that changed speed on the same frame as the state would read as a
 * glitch; weather turns, it does not cut.
 */

/** Hard ceiling from motionProfile.maxParticles. The pool never exceeds this. */
const MAX_PETALS = 28
const TARGET_FRAME_MS = 1000 / 60 // sakura's motionProfile.targetFps

/** dt is clamped to this so a backgrounded window can't integrate one huge step. */
const MAX_STEP_MS = 64

const PETAL_FILL = [227, 154, 168] as const // accent.primary, lantern rose
const PETAL_PALE = [240, 185, 196] as const // text.accent, the lit edge

interface Petal {
  x: number
  y: number
  vx: number
  vy: number
  /** Terminal fall speed, px/ms. */
  fall: number
  swayAmp: number
  swayFreq: number
  swayPhase: number
  /** In-plane orientation. */
  spin: number
  spinSpeed: number
  /** Rotation about the petal's own long axis. Drives the foreshortening. */
  roll: number
  rollSpeed: number
  size: number
  alpha: number
  pale: boolean
}

/** Deterministic, so the composition is identical on every mount. mulberry32. */
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

function makePetals(width: number, height: number): Petal[] {
  const random = makeRandom(0x5a4b)
  return Array.from({ length: MAX_PETALS }, () => ({
    x: random() * width,
    // Seeded across the full height, not at the top: at t=0 the field is
    // already falling, which is also what makes the reduced-motion still frame
    // a composition rather than a row of petals along the ceiling.
    y: random() * height,
    vx: 0,
    vy: 0,
    fall: 0.012 + random() * 0.022,
    swayAmp: 0.006 + random() * 0.014,
    swayFreq: 0.0009 + random() * 0.0016,
    swayPhase: random() * Math.PI * 2,
    spin: random() * Math.PI * 2,
    spinSpeed: (random() - 0.5) * 0.0012,
    roll: random() * Math.PI * 2,
    rollSpeed: 0.0009 + random() * 0.0022,
    size: 5 + random() * 7,
    alpha: 0.4 + random() * 0.45,
    pale: random() < 0.35,
  }))
}

/**
 * One petal: three anchor points — base, tip, and the two flanks — closed with
 * a pair of cubics, with a cleft at the tip. Drawn in the petal's own space so
 * the two rotations compose as a transform rather than as trigonometry on every
 * vertex.
 *
 * `roll` is the whole flutter. Scaling x by cos(roll) turns the petal edge-on
 * twice a cycle, where it nearly vanishes and then opens out again. Without it
 * a falling petal reads as confetti, which is the failure the brief's
 * "independent rotation on two axes" is guarding against.
 */
function drawPetal(ctx: CanvasRenderingContext2D, p: Petal): void {
  const face = Math.cos(p.roll)
  const s = p.size

  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.spin)
  ctx.scale(face, 1)

  const [r, g, b] = p.pale ? PETAL_PALE : PETAL_FILL
  // Edge-on petals catch less light, so the alpha follows the foreshortening.
  ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${(p.alpha * (0.35 + 0.65 * Math.abs(face))).toFixed(3)})`

  ctx.beginPath()
  ctx.moveTo(0, -s * 0.5)
  ctx.bezierCurveTo(s * 0.62, -s * 0.2, s * 0.5, s * 0.52, 0, s * 0.5)
  // The cleft tip — sakura petals are notched, and at this size it is the only
  // thing distinguishing the silhouette from a generic teardrop.
  ctx.lineTo(0, s * 0.3)
  ctx.lineTo(0, s * 0.5)
  ctx.bezierCurveTo(-s * 0.5, s * 0.52, -s * 0.62, -s * 0.2, 0, -s * 0.5)
  ctx.fill()

  ctx.restore()
}

function drawMist(ctx: CanvasRenderingContext2D, width: number, height: number, elapsed: number): void {
  const blobs = [
    { x: 0.26, y: 0.94, r: 0.42, speed: 0.000021, phase: 0.0, color: 'rgba(40, 34, 49, 0.5)' },
    { x: 0.74, y: 0.99, r: 0.5, speed: 0.000016, phase: 2.4, color: 'rgba(30, 27, 36, 0.45)' },
  ]
  for (const blob of blobs) {
    const drift = Math.sin(elapsed * blob.speed + blob.phase)
    const x = (blob.x + drift * 0.07) * width
    const y = blob.y * height
    const rad = blob.r * Math.max(width, height)
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, rad)
    gradient.addColorStop(0, blob.color)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }
}

/**
 * Where the petals are drawn toward while a response generates. Read from the
 * live layout via the `.chat-surface` structural class rather than hardcoded:
 * the ambient layer is full-viewport and knows nothing about the app's columns,
 * and a magic number here would silently drift the moment a panel resized.
 *
 * Measured only on resize and on an activity change — never inside the loop.
 */
function readAnchor(width: number, height: number): { x: number; y: number } {
  const el = document.querySelector('.chat-surface')
  if (el) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) {
      return { x: r.left + r.width / 2, y: r.top + r.height * 0.42 }
    }
  }
  return { x: width * 0.5, y: height * 0.45 }
}

export default function SakuraEffects({ reducedMotion, paused, activity }: EffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const petalsRef = useRef<Petal[] | null>(null)
  const elapsedRef = useRef(0)
  const lastFrameRef = useRef<number | null>(null)
  const anchorRef = useRef({ x: 0, y: 0 })
  // Eased toward the target set by `activity`, so a state change turns the
  // weather instead of cutting it.
  const pullRef = useRef(0)
  const calmRef = useRef(1)
  const activityRef = useRef<ReiganState>(activity)

  // Kept in a ref, and deliberately *not* a dependency of the loop effect
  // below: a new assistant state must retarget the petals, never tear down and
  // restart the RAF loop.
  useEffect(() => {
    activityRef.current = activity
    const canvas = canvasRef.current
    if (canvas) anchorRef.current = readAnchor(window.innerWidth, window.innerHeight)
  }, [activity])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Capped at 2: past that the two full-viewport mist gradients cost more
    // fill than the sharper petals are worth.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = window.innerWidth
    let height = window.innerHeight

    const resize = () => {
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      anchorRef.current = readAnchor(width, height)
    }
    resize()
    window.addEventListener('resize', resize)

    if (petalsRef.current === null) petalsRef.current = makePetals(width, height)
    const petals = petalsRef.current

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      drawMist(ctx, width, height, elapsedRef.current)
      for (const p of petals) drawPetal(ctx, p)
    }

    if (reducedMotion) {
      // Static but complete: mist plus the full petal field, distributed by the
      // seeding above. No loop is ever started.
      draw()
      return () => window.removeEventListener('resize', resize)
    }

    if (paused) {
      return () => window.removeEventListener('resize', resize)
    }

    const step = (dt: number) => {
      const target = responseFor(activityRef.current)
      pullRef.current = approach(pullRef.current, target.pull, dt)
      calmRef.current = approach(calmRef.current, target.calm, dt)

      const pull = pullRef.current
      const calm = calmRef.current
      const anchor = anchorRef.current
      const speed = calm * (1 + pull * 1.6)

      for (const p of petals) {
        // Base drift: terminal fall plus a lateral sway, which is what keeps a
        // petal from tracking a straight line down.
        const sway = Math.sin(elapsedRef.current * p.swayFreq + p.swayPhase) * p.swayAmp
        let ax = sway
        let ay = p.fall

        if (pull > 0.001) {
          const dx = anchor.x - p.x
          const dy = anchor.y - p.y
          const d = Math.hypot(dx, dy) || 1
          // Radial draw toward the response area, plus a tangential component
          // of the same order — the tangent is what makes it a swirl rather
          // than a vacuum cleaner.
          ax += ((dx / d) * 0.85 + (-dy / d) * 0.55) * pull * 0.03
          ay += ((dy / d) * 0.85 + (dx / d) * 0.55) * pull * 0.03
        }

        p.vx += (ax * speed - p.vx) * Math.min(1, dt / 260)
        p.vy += (ay * speed - p.vy) * Math.min(1, dt / 260)
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.spin += p.spinSpeed * dt * speed
        p.roll += p.rollSpeed * dt * speed

        // Fixed pool: a petal that leaves the frame is repositioned, never
        // reallocated.
        if (p.y - p.size > height) {
          p.y = -p.size * 2
          p.x = Math.random() * width
          p.vx = 0
          p.vy = 0
        } else if (p.y + p.size < -height * 0.3) {
          p.y = height + p.size
        }
        if (p.x - p.size > width) p.x = -p.size
        else if (p.x + p.size < 0) p.x = width + p.size
      }
    }

    const tick = (now: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = Math.min(now - lastFrameRef.current, MAX_STEP_MS)

      // Throttled to the profile's 60fps: this app runs on a 180Hz display, and
      // without the gate the loop would integrate and repaint three times per
      // frame the user can actually see.
      if (dt >= TARGET_FRAME_MS) {
        lastFrameRef.current = now
        elapsedRef.current += dt
        step(dt)
        draw()
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      lastFrameRef.current = null
    }
  }, [reducedMotion, paused])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
    />
  )
}
