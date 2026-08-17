import { useEffect, useRef } from 'react'
import type { EffectsProps } from '../../types'

/**
 * Yozakura ambient layer — the low night mist, and only that.
 *
 * The petals moved to a panel-scoped field (field.ts) so they fall *behind* the
 * chat and the rail instead of drifting over them. What stays here is the part
 * that was never a particle: two slow radial blooms low in the frame, which are
 * the garden the petals fall through and belong to the whole window.
 *
 * Deliberately throttled to 30fps rather than the theme's 60. That rate exists
 * for the petals, whose flutter stutters below it; drifting mist moves a few
 * pixels a second and halving its repaints halves the layer's fill cost — the
 * one real expense here, since each blob is a full-viewport gradient.
 */

const MIST_FRAME_MS = 1000 / 30

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

export default function SakuraEffects({ reducedMotion, paused }: EffectsProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number | null>(null)
  const elapsedRef = useRef(0)
  const lastFrameRef = useRef<number | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Capped at 2: past that two full-viewport gradients cost more fill than
    // the extra resolution buys on a soft-edged blob.
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
    }
    resize()
    window.addEventListener('resize', resize)

    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      drawMist(ctx, width, height, elapsedRef.current)
    }

    draw()

    // Still but complete in both cases — the mist is painted, the loop simply
    // never starts.
    if (reducedMotion || paused) {
      return () => window.removeEventListener('resize', resize)
    }

    const tick = (now: number) => {
      if (lastFrameRef.current === null) lastFrameRef.current = now
      const dt = now - lastFrameRef.current
      if (dt >= MIST_FRAME_MS) {
        lastFrameRef.current = now
        elapsedRef.current += dt
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
