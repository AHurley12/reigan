import type { FieldInit, ParticleField, RegionId } from '../../particles/types'
import { countForArea, regionBudget } from '../../particles/types'
import { makeRandom, range } from '../../particles/rng'

/**
 * Shingan ambient field — orange current, running in the seams.
 *
 * The obvious reading of "electricity" is bolts thrown across the middle of the
 * screen, which on a hanko/viewfinder skin would look like weather in a room
 * that has none. This does the opposite: discharges strike *along the edges* of
 * the panel they live in, parallel to the moulding, so the UI's own geometry is
 * what carries the charge — the frame is energised, not the air — which is the
 * reading the seal-and-instrument identity actually supports.
 *
 * Between strikes the field is held alive by static: a sparse population of
 * points that flicker at the seams and crawl, so the panel is never dead
 * during a gap.
 *
 * Colours are the skin's own — shu vermillion (#D8432A) blooming out from an
 * amber (#E0A54A) body and a near-white core.
 */

/** 2 endpoints subdivided 5 times. */
const MAX_TRUNK_POINTS = 33
/** 2 endpoints subdivided 4 times. */
const MAX_FORK_POINTS = 17
const MAX_FORKS = 2
const TRUNK_LEVELS = 5
const FORK_LEVELS = 4

/**
 * Displacement as a fraction of the segment being split. This is what makes the
 * path self-similar — the same roughness at 400px as at 12px — and it is the
 * difference between a discharge and a drawn wire.
 */
const ROUGHNESS = 0.4

/** How far a seam run sits inside the panel edge, in px. Clears the moulding. */
const SEAM_INSET = 13

/**
 * Scratch for path generation. Module-level and shared because only one arc is
 * ever generated at a time (synchronously, inside step), and the skin contract
 * asks for a fixed pool with no per-particle allocation.
 */
const SCRATCH_A = new Float32Array(MAX_TRUNK_POINTS * 2)
const SCRATCH_B = new Float32Array(MAX_TRUNK_POINTS * 2)

interface Polyline {
  pts: Float32Array
  count: number
}

interface Arc {
  trunk: Polyline
  forks: Polyline[]
  forkCount: number
  /** ms since the strike began. */
  life: number
  duration: number
  width: number
  flickerPhase: number
  active: boolean
  /** ms until this slot strikes again. */
  cooldown: number
}

interface Spark {
  x: number
  y: number
  /** px/ms crawl along the seam. */
  drift: number
  size: number
  peak: number
  /** rad/ms. */
  freq: number
  phase: number
  /** Which edge this spark clings to. */
  edge: number
  /** ms until it jumps to a new spot on the same seam. */
  jump: number
}

/**
 * One subdivision pass: every segment gains a midpoint pushed off the segment
 * normal.
 *
 * The offset is a fraction of that segment's own length, capped at `maxDev`.
 * The fraction is what keeps the path equally ragged at every scale; the cap is
 * what keeps a long run pinned to the seam it belongs to, since without it the
 * first pass on a 400px span would throw the midpoint most of the way across
 * the panel.
 */
function displace(
  src: Float32Array,
  count: number,
  dst: Float32Array,
  maxDev: number,
  random: () => number
): number {
  let w = 0
  for (let i = 0; i < (count - 1) * 2; i += 2) {
    const x0 = src[i]
    const y0 = src[i + 1]
    const x1 = src[i + 2]
    const y1 = src[i + 3]
    dst[w++] = x0
    dst[w++] = y0
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy) || 1
    const off = (random() - 0.5) * Math.min(len * ROUGHNESS, maxDev * 2)
    dst[w++] = (x0 + x1) / 2 - (dy / len) * off
    dst[w++] = (y0 + y1) / 2 + (dx / len) * off
  }
  dst[w++] = src[(count - 1) * 2]
  dst[w++] = src[(count - 1) * 2 + 1]
  return w / 2
}

/** Builds a bolt from a to b into `into`, via `levels` subdivision passes. */
function boltInto(
  into: Polyline,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  maxDev: number,
  levels: number,
  random: () => number
): void {
  SCRATCH_A[0] = ax
  SCRATCH_A[1] = ay
  SCRATCH_A[2] = bx
  SCRATCH_A[3] = by
  let src = SCRATCH_A
  let dst = SCRATCH_B
  let count = 2

  for (let level = 0; level < levels; level++) {
    count = displace(src, count, dst, maxDev, random)
    const swap = src
    src = dst
    dst = swap
  }

  into.pts.set(src.subarray(0, count * 2))
  into.count = count
}

/**
 * Picks the two endpoints of a strike.
 *
 * The rail is one tall sliver, so its only sensible run is vertical down the
 * spine. The module area picks one of its four edges and runs parallel to it.
 *
 * There is deliberately no arc across the middle. An earlier pass had a
 * minority of strikes jumping corner to corner, and rendered side by side with
 * the seam runs it was plainly the wrong thing twice over: it drew a bright
 * diagonal straight through the column of text the panel exists to hold, and it
 * turned a specific idea — the frame is carrying current — back into generic
 * lightning. The restraint is the effect.
 */
function pickEndpoints(
  region: RegionId,
  width: number,
  height: number,
  random: () => number
): { ax: number; ay: number; bx: number; by: number; amp: number } {
  if (region === 'nav') {
    const x = width / 2 + range(random, -width * 0.16, width * 0.16)
    const span = range(random, 0.22, 0.5) * height
    const top = range(random, 0, height - span)
    return { ax: x, ay: top, bx: x + range(random, -6, 6), by: top + span, amp: range(random, 7, 15) }
  }

  const inset = SEAM_INSET
  const amp = range(random, 8, 18)
  const horizontal = random() < 0.5
  if (horizontal) {
    const y = random() < 0.5 ? inset : height - inset
    const span = range(random, 0.2, 0.48) * width
    const start = range(random, 0, width - span)
    return { ax: start, ay: y, bx: start + span, by: y + range(random, -8, 8), amp }
  }
  const x = random() < 0.5 ? inset : width - inset
  const span = range(random, 0.2, 0.48) * height
  const start = range(random, 0, height - span)
  return { ax: x, ay: start, bx: x + range(random, -8, 8), by: start + span, amp }
}

function makePolyline(points: number): Polyline {
  return { pts: new Float32Array(points * 2), count: 0 }
}

/**
 * Brightness over a strike's life: a near-instant rise, a decay, and a flicker
 * riding on top. The flicker is what sells it — a clean fade reads as a glow
 * turning off, where real discharge stutters as it dies.
 */
function envelope(arc: Arc): number {
  const t = arc.life / arc.duration
  if (t >= 1) return 0
  const rise = t < 0.1 ? t / 0.1 : 1
  const decay = t < 0.1 ? 1 : Math.pow(1 - (t - 0.1) / 0.9, 1.7)
  const flicker = 0.6 + 0.4 * Math.abs(Math.sin(arc.life * 0.042 + arc.flickerPhase))
  return rise * decay * flicker
}

function strokePolyline(ctx: CanvasRenderingContext2D, line: Polyline): void {
  if (line.count < 2) return
  ctx.beginPath()
  ctx.moveTo(line.pts[0], line.pts[1])
  for (let i = 2; i < line.count * 2; i += 2) ctx.lineTo(line.pts[i], line.pts[i + 1])
  ctx.stroke()
}

export function createField({ region, width, height, maxParticles }: FieldInit): ParticleField {
  const random = makeRandom(region === 'nav' ? 0x5a17 : 0x5a18)
  const budget = regionBudget(region, maxParticles)

  // The rail gets one slot; the module area three. More than that and the gaps
  // stop being gaps.
  const arcSlots = region === 'nav' ? 1 : 3
  const gapMin = region === 'nav' ? 2000 : 1000
  const gapMax = region === 'nav' ? 5200 : 3400

  let w = Math.max(1, width)
  let h = Math.max(1, height)

  const arcs: Arc[] = Array.from({ length: arcSlots }, () => ({
    trunk: makePolyline(MAX_TRUNK_POINTS),
    forks: Array.from({ length: MAX_FORKS }, () => makePolyline(MAX_FORK_POINTS)),
    forkCount: 0,
    life: 0,
    duration: 0,
    width: 1,
    flickerPhase: 0,
    active: false,
    // Staggered, so the slots never fire in unison after a mount.
    cooldown: range(random, 200, gapMax),
  }))

  const sparkCount =
    region === 'nav'
      ? countForArea(w, h, 160, budget, 5)
      : countForArea(w, h, 26, budget, 10)

  const seedSpark = (s: Spark): void => {
    s.edge = region === 'nav' ? 4 : Math.floor(random() * 5)
    const inset = SEAM_INSET
    switch (s.edge) {
      case 0: s.x = range(random, inset, w - inset); s.y = inset + range(random, -4, 4); break
      case 1: s.x = w - inset + range(random, -4, 4); s.y = range(random, inset, h - inset); break
      case 2: s.x = range(random, inset, w - inset); s.y = h - inset + range(random, -4, 4); break
      case 3: s.x = inset + range(random, -4, 4); s.y = range(random, inset, h - inset); break
      // The spine — the rail's only seam, and a minority of the module area's
      // sparks, so the middle of the panel is not completely inert.
      default: s.x = w / 2 + range(random, -w * 0.18, w * 0.18); s.y = range(random, 0, h)
    }
    s.jump = range(random, 1800, 6000)
  }

  const sparks: Spark[] = Array.from({ length: sparkCount }, () => {
    const s: Spark = {
      x: 0, y: 0,
      // 25–70 px/s, and signed away from zero so no spark is ever effectively
      // parked. An earlier pass drifted at ±6 px/s, which is below the rate a
      // person reads as movement at all: the sparks flickered in place and the
      // field looked frozen between strikes. Charge creeping along a conductor
      // is the reading, so it has to visibly travel.
      drift: (random() < 0.5 ? -1 : 1) * range(random, 0.025, 0.07),
      size: range(random, 0.7, 1.7),
      peak: range(random, 0.35, 0.9),
      // Fast, and deliberately not harmonically related between sparks — a
      // shared period would read as a pulse rather than as static.
      freq: range(random, 0.007, 0.02),
      phase: random() * Math.PI * 2,
      edge: 0,
      jump: 0,
    }
    seedSpark(s)
    return s
  })

  const strike = (arc: Arc): void => {
    const { ax, ay, bx, by, amp } = pickEndpoints(region, w, h, random)
    boltInto(arc.trunk, ax, ay, bx, by, amp, TRUNK_LEVELS, random)

    arc.forkCount = random() < 0.55 ? (random() < 0.35 ? 2 : 1) : 0
    for (let i = 0; i < arc.forkCount; i++) {
      // Forks leave the trunk at a real vertex, so the join never floats.
      const at = 2 + Math.floor(random() * (arc.trunk.count - 3)) * 2
      const fx = arc.trunk.pts[at]
      const fy = arc.trunk.pts[at + 1]
      const angle = random() * Math.PI * 2
      const len = range(random, 0.14, 0.36) * Math.hypot(bx - ax, by - ay)
      boltInto(
        arc.forks[i],
        fx, fy,
        fx + Math.cos(angle) * len,
        fy + Math.sin(angle) * len,
        amp * 0.6,
        FORK_LEVELS,
        random
      )
    }

    arc.life = 0
    arc.duration = range(random, 140, 280)
    arc.width = range(random, 0.9, 1.7)
    arc.flickerPhase = random() * Math.PI * 2
    arc.active = true
  }

  // Seeded mid-life so the reduced-motion still frame catches a strike in
  // progress rather than an empty panel.
  strike(arcs[0])
  arcs[0].life = arcs[0].duration * 0.35

  return {
    resize(nextWidth, nextHeight) {
      const sx = nextWidth / w
      const sy = nextHeight / h
      w = Math.max(1, nextWidth)
      h = Math.max(1, nextHeight)
      // Sparks scale with the box; a live arc is short enough that letting it
      // finish where it was drawn is cheaper and less visible than remapping it.
      for (const s of sparks) {
        s.x *= sx
        s.y *= sy
      }
    },

    step(dt) {
      for (const arc of arcs) {
        if (arc.active) {
          arc.life += dt
          if (arc.life >= arc.duration) {
            arc.active = false
            arc.cooldown = range(random, gapMin, gapMax)
          }
          continue
        }
        arc.cooldown -= dt
        if (arc.cooldown <= 0) strike(arc)
      }

      for (const s of sparks) {
        s.phase += s.freq * dt
        // Crawl along the seam it clings to, not across it.
        if (s.edge === 0 || s.edge === 2) s.x += s.drift * dt
        else s.y += s.drift * dt

        s.jump -= dt
        if (s.jump <= 0) seedSpark(s)
        else if (s.x < -4 || s.x > w + 4 || s.y < -4 || s.y > h + 4) seedSpark(s)
      }
    },

    draw(ctx) {
      ctx.save()
      // Additive: overlapping passes build a hot core out of three cheap
      // strokes, which is far less costly than a shadowBlur per arc.
      ctx.globalCompositeOperation = 'lighter'
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'

      for (const s of sparks) {
        // Squared so the flicker sits dark most of the cycle and snaps bright,
        // rather than breathing evenly like an ember.
        const pulse = Math.pow((Math.sin(s.phase) + 1) / 2, 2.4)
        const a = s.peak * pulse
        if (a < 0.02) continue
        ctx.fillStyle = `rgba(224, 165, 74, ${(a * 0.22).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size * 2.6, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = `rgba(255, 227, 184, ${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
      }

      for (const arc of arcs) {
        if (!arc.active) continue
        const env = envelope(arc)
        if (env <= 0.01) continue

        // Three passes, widest and dimmest first: vermillion bloom, amber body,
        // near-white core.
        const passes: [number, string][] = [
          [arc.width * 5.5, `rgba(216, 67, 42, ${(0.1 * env).toFixed(3)})`],
          [arc.width * 2.4, `rgba(224, 165, 74, ${(0.3 * env).toFixed(3)})`],
          [arc.width * 0.85, `rgba(255, 233, 200, ${(0.9 * env).toFixed(3)})`],
        ]
        for (const [lineWidth, stroke] of passes) {
          ctx.lineWidth = lineWidth
          ctx.strokeStyle = stroke
          strokePolyline(ctx, arc.trunk)
          for (let i = 0; i < arc.forkCount; i++) strokePolyline(ctx, arc.forks[i])
        }
      }

      ctx.restore()
    },
  }
}
