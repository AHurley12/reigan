import { useEffect, useRef } from 'react'
import type { EffectsProps } from '../../types'

const TARGET_FRAME_MS = 1000 / 30 // gothic's motionProfile.targetFps
const BAT_MIN_GAP_MS = 30_000
const BAT_MAX_GAP_MS = 90_000
const BAT_DURATION_MS = 8_000
const ASH_COUNT = 26 // well under motionProfile.maxParticles (40)

interface FogBlob {
  baseX: number // 0–1 of width
  baseY: number // 0–1 of height, kept low (fog hugs the bottom third)
  radius: number // 0–1 of max(width, height)
  speed: number // radians/ms
  phase: number
  color: string
}

interface Bat {
  startedAt: number
  y: number // 0–0.33 of height, upper third
  dir: 1 | -1
  wobbleSeed: number
}

interface AshMote {
  x0: number // 0–1, horizontal anchor
  swayAmp: number // 0–1 fraction of width
  swaySeed: number
  cycleMs: number // time to drift the full screen height
  startFrac: number // 0–1 initial phase into the cycle
  size: number // px
  ember: boolean // oxblood-tinted vs. silver ash
}

function makeAshMotes(): AshMote[] {
  return Array.from({ length: ASH_COUNT }, () => ({
    x0: Math.random(),
    swayAmp: 0.01 + Math.random() * 0.02,
    swaySeed: Math.random() * Math.PI * 2,
    cycleMs: 22_000 + Math.random() * 16_000,
    startFrac: Math.random(),
    size: 0.8 + Math.random() * 1.6,
    ember: Math.random() < 0.3,
  }))
}

function drawAshMotes(ctx: CanvasRenderingContext2D, width: number, height: number, motes: AshMote[], elapsedMs: number): void {
  for (const mote of motes) {
    const progress = ((elapsedMs + mote.startFrac * mote.cycleMs) % mote.cycleMs) / mote.cycleMs
    const y = (1.05 - progress * 1.1) * height
    const x = (mote.x0 + Math.sin(elapsedMs * 0.0004 + mote.swaySeed) * mote.swayAmp) * width
    const fade = Math.sin(progress * Math.PI) // fades in/out at top and bottom of travel
    ctx.beginPath()
    ctx.fillStyle = mote.ember ? `rgba(158, 42, 61, ${0.5 * fade})` : `rgba(173, 171, 163, ${0.35 * fade})`
    ctx.arc(x, y, mote.size, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  fog: FogBlob[],
  motes: AshMote[],
  elapsedMs: number,
  bat: Bat | null
): void {
  ctx.clearRect(0, 0, width, height)

  // Drifting fog — soft radial gradients low in the frame.
  for (const blob of fog) {
    const drift = Math.sin(elapsedMs * blob.speed + blob.phase)
    const x = (blob.baseX + drift * 0.06) * width
    const y = (blob.baseY + Math.cos(elapsedMs * blob.speed * 0.7 + blob.phase) * 0.02) * height
    const r = blob.radius * Math.max(width, height)
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r)
    gradient.addColorStop(0, blob.color)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
  }

  drawAshMotes(ctx, width, height, motes, elapsedMs)

  // Vignette
  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.35,
    width / 2, height / 2, Math.max(width, height) * 0.75
  )
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, 'rgba(6,7,10,0.35)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)

  // Bat — small distant silhouette, upper third, long slow crossing.
  if (bat) {
    const t = Math.min(1, (elapsedMs - bat.startedAt) / BAT_DURATION_MS)
    const x = bat.dir === 1 ? -0.05 + t * 1.1 : 1.05 - t * 1.1
    const wingFlap = Math.sin(elapsedMs * 0.012 + bat.wobbleSeed) * 0.5 + 0.5
    const cx = x * width
    const cy = bat.y * height + Math.sin(elapsedMs * 0.0015 + bat.wobbleSeed) * height * 0.02
    const size = Math.min(width, height) * 0.012
    ctx.save()
    ctx.globalAlpha = 0.28 * Math.sin(Math.PI * t) + 0.08
    ctx.fillStyle = '#050608'
    ctx.beginPath()
    ctx.moveTo(cx, cy)
    ctx.quadraticCurveTo(cx - size * (1.4 + wingFlap), cy - size * 0.6, cx - size * 2.2, cy)
    ctx.quadraticCurveTo(cx - size * 1.2, cy + size * 0.3, cx, cy)
    ctx.quadraticCurveTo(cx + size * 1.2, cy + size * 0.3, cx + size * 2.2, cy)
    ctx.quadraticCurveTo(cx + size * (1.4 + wingFlap), cy - size * 0.6, cx, cy)
    ctx.fill()
    ctx.restore()
  }
}

/**
 * Sepulchral ambient layer: drifting low fog, rising ash/ember motes, and an
 * occasional distant bat crossing. One RAF loop for the whole thing. Static
 * ornament (silver linings, filigree, the memento-mori watermark) is CSS —
 * see ornament.css — so it never costs a frame.
 */
export default function GothicEffects({ reducedMotion, paused }: EffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const lastFrameRef = useRef<number | null>(null)
  const lastDrawRef = useRef(0)
  const batRef = useRef<Bat | null>(null)
  const batTimeoutRef = useRef<number | null>(null)
  const motesRef = useRef<AshMote[]>(makeAshMotes())
  const fogRef = useRef<FogBlob[]>([
    { baseX: 0.2, baseY: 0.85, radius: 0.32, speed: 0.00004, phase: 0, color: 'rgba(20, 22, 28, 0.55)' },
    { baseX: 0.7, baseY: 0.92, radius: 0.38, speed: 0.00003, phase: 2.1, color: 'rgba(16, 17, 22, 0.5)' },
    { baseX: 0.45, baseY: 0.78, radius: 0.26, speed: 0.00005, phase: 4.4, color: 'rgba(24, 26, 33, 0.4)' },
  ])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    if (reducedMotion) {
      // Static but complete composition — no RAF loop, no bat, motes frozen mid-drift.
      drawFrame(ctx, canvas.width, canvas.height, fogRef.current, motesRef.current, 0, null)
      return () => window.removeEventListener('resize', resize)
    }

    if (paused) {
      return () => window.removeEventListener('resize', resize)
    }

    const scheduleBat = () => {
      const gap = BAT_MIN_GAP_MS + Math.random() * (BAT_MAX_GAP_MS - BAT_MIN_GAP_MS)
      batTimeoutRef.current = window.setTimeout(() => {
        batRef.current = {
          startedAt: elapsedRef.current,
          y: 0.05 + Math.random() * 0.22,
          dir: Math.random() > 0.5 ? 1 : -1,
          wobbleSeed: Math.random() * Math.PI * 2,
        }
        scheduleBat()
      }, gap)
    }
    scheduleBat()

    const tick = (now: number) => {
      if (lastFrameRef.current !== null) {
        elapsedRef.current += now - lastFrameRef.current
      }
      lastFrameRef.current = now

      if (batRef.current && elapsedRef.current - batRef.current.startedAt > BAT_DURATION_MS) {
        batRef.current = null
      }

      if (now - lastDrawRef.current >= TARGET_FRAME_MS) {
        lastDrawRef.current = now
        drawFrame(ctx, canvas.width, canvas.height, fogRef.current, motesRef.current, elapsedRef.current, batRef.current)
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('resize', resize)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      if (batTimeoutRef.current !== null) window.clearTimeout(batTimeoutRef.current)
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
