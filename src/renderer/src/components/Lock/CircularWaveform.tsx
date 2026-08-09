import { useEffect, useRef } from 'react'
import { useTheme } from '../../theme/useTheme'
import type { QualityTier } from '../../hooks/useAdaptivePerformance'

/**
 * Radial audio visualiser.
 *
 * Canvas rather than SVG, and only while actually listening — a canvas that
 * repaints 60 times a second is the single most expensive thing on the lock
 * screen, so it is mounted only in the listening/processing phases and its rAF
 * loop stops dead the moment `active` goes false.
 *
 * It also never touches React state. The analyser is read straight out of a
 * ref inside the draw loop, so a full second of visualisation costs zero
 * renders and zero reconciliation.
 */

interface CircularWaveformProps {
  analyserRef: React.MutableRefObject<AnalyserNode | null>
  active: boolean
  tier: QualityTier
  /** Hard stop — hidden window or reduced motion. */
  suspended?: boolean
  size?: number
  /** Fraction of `size` used as the quiet-state radius. */
  innerRadiusRatio?: number
}

/** Bar counts per tier. Fewer bars is the cheapest possible quality lever. */
const BAR_COUNT: Record<QualityTier, number> = { high: 96, medium: 64, low: 40 }

export function CircularWaveform({
  analyserRef,
  active,
  tier,
  suspended = false,
  size = 240,
  innerRadiusRatio = 0.34,
}: CircularWaveformProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { theme } = useTheme()
  const accent = theme.tokens.accent.primary
  const secondary = theme.tokens.accent.secondary

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    // Cap DPR at 2. Beyond that the pixel cost quadruples for a visualiser
    // nobody inspects closely, and integrated GPUs feel it immediately.
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = size * dpr
    canvas.height = size * dpr
    canvas.style.width = `${size}px`
    canvas.style.height = `${size}px`
    ctx.scale(dpr, dpr)

    if (!active || suspended) {
      ctx.clearRect(0, 0, size, size)
      return
    }

    const bars = BAR_COUNT[tier]
    const centre = size / 2
    const innerRadius = size * innerRadiusRatio
    const maxBar = centre - innerRadius - 6

    // Reused across frames — allocating a 512-byte array 60 times a second is
    // avoidable GC pressure on exactly the machines this needs to be light on.
    // Explicit ArrayBuffer generic: the DOM types narrowed getByteFrequencyData
    // to reject the SharedArrayBuffer-backed variant that bare Uint8Array allows.
    let freq: Uint8Array<ArrayBuffer> | null = null
    // Smoothed bar heights, so a spiky FFT does not read as jitter.
    const smoothed = new Float32Array(bars)

    let raf = 0
    let lastFrame = 0
    // Low tier throttles to ~30fps: the brief's graceful degradation target.
    const minFrameMs = tier === 'low' ? 33 : 0

    const draw = (now: number): void => {
      raf = requestAnimationFrame(draw)
      if (minFrameMs && now - lastFrame < minFrameMs) return
      lastFrame = now

      const analyser = analyserRef.current
      ctx.clearRect(0, 0, size, size)
      if (!analyser) return

      if (!freq || freq.length !== analyser.frequencyBinCount) {
        freq = new Uint8Array(analyser.frequencyBinCount)
      }
      analyser.getByteFrequencyData(freq)

      // Speech energy is concentrated low; sampling the whole spectrum linearly
      // wastes most bars on near-silent high bins. Take the lower ~60%.
      const usable = Math.floor(freq.length * 0.6)

      for (let i = 0; i < bars; i++) {
        const bin = Math.floor((i / bars) * usable)
        const target = (freq[bin] / 255) ** 1.4
        smoothed[i] += (target - smoothed[i]) * 0.35

        const angle = (i / bars) * Math.PI * 2 - Math.PI / 2
        const length = 2 + smoothed[i] * maxBar
        const cos = Math.cos(angle)
        const sin = Math.sin(angle)

        ctx.beginPath()
        ctx.moveTo(centre + cos * innerRadius, centre + sin * innerRadius)
        ctx.lineTo(centre + cos * (innerRadius + length), centre + sin * (innerRadius + length))
        ctx.strokeStyle = i % 2 === 0 ? accent : secondary
        ctx.globalAlpha = 0.35 + smoothed[i] * 0.65
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ctx.clearRect(0, 0, size, size)
    }
  }, [active, suspended, tier, size, innerRadiusRatio, accent, secondary, analyserRef])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 m-auto"
      style={{ width: size, height: size }}
    />
  )
}
