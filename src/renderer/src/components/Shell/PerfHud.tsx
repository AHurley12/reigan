import { useEffect, useRef, useState } from 'react'

interface Stats {
  fps: number
  frameMs: number
  heapMb: number | null
}

/**
 * Dev-only overlay for verifying the animation contract's perf gates
 * (theme docs / DoD checklist) — not part of any theme's Effects, so it
 * doesn't count against the "one RAF loop per theme" rule. Gated behind
 * VITE_PERF_HUD so it never ships in a normal build.
 */
export function PerfHud() {
  const [stats, setStats] = useState<Stats>({ fps: 0, frameMs: 0, heapMb: null })
  const framesRef = useRef<number[]>([])
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    let lastSample = performance.now()

    const tick = (now: number) => {
      framesRef.current.push(now)
      const cutoff = now - 1000
      while (framesRef.current.length && framesRef.current[0] < cutoff) framesRef.current.shift()

      if (now - lastSample >= 500) {
        lastSample = now
        const fps = framesRef.current.length
        const frameMs = fps > 0 ? 1000 / fps : 0
        const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        setStats({ fps, frameMs, heapMb: memory ? memory.usedJSHeapSize / 1_048_576 : null })
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div
      className="fixed bottom-3 left-3 z-[9999] rounded px-2.5 py-1.5 font-mono text-[12px] leading-tight"
      style={{ background: 'var(--surface-scrim)', color: 'var(--accent-success)', pointerEvents: 'none' }}
    >
      <div>{stats.fps} fps · {stats.frameMs.toFixed(1)} ms/frame</div>
      {stats.heapMb !== null && <div>heap {stats.heapMb.toFixed(1)} MB</div>}
    </div>
  )
}
