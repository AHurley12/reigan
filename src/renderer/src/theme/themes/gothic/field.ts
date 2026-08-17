import type { FieldInit, ParticleField } from '../../particles/types'
import { countForArea, regionBudget } from '../../particles/types'
import { makeRandom, range } from '../../particles/rng'

/**
 * Sepulchral ambient field — grey dust and black soot, falling.
 *
 * Two marks, not one grade of grey. Dust is mineral: soft, round, almost
 * weightless, and it wanders a long way sideways on its way down. Soot is
 * burnt: an irregular flake that tumbles and falls faster. A single particle
 * type would have read as snow, which is a different season and a different
 * mood entirely.
 *
 * Nothing here falls at a constant rate. Each mote's descent is modulated by
 * its own slow bob, so the field never settles into the vertical rain that
 * gives a cheap particle layer away.
 *
 * Direction matters and is the point: `y` increases. The ash motes this
 * replaced travelled bottom-to-top across the whole window, which is embers
 * rising off a fire — a warm, upward, living image, and the opposite of what a
 * mourning skin wants. Dust settles.
 *
 * The theme's fog, vignette and the occasional bat stay in the full-viewport
 * layer (Effects.tsx) — those are atmosphere over the whole window, where this
 * is dust settling inside two specific panels.
 */

const DUST = 0
const SOOT = 1

/** Distance over which a mote fades at the top and bottom of its travel. */
const EDGE_FADE = 44

interface Mote {
  kind: typeof DUST | typeof SOOT
  x: number
  y: number
  /** Terminal fall rate, px/ms. Positive is downward. */
  fall: number
  /** Fraction by which `bob` modulates the fall rate. */
  bobAmp: number
  bobFreq: number
  bobPhase: number
  swayAmp: number
  swayFreq: number
  swayPhase: number
  /** Constant lateral drift, px/ms — a draught in the room. */
  drift: number
  size: number
  alpha: number
  spin: number
  spinSpeed: number
  /** Four corner offsets, in units of `size`. Soot only. */
  shape: Float32Array
}

/**
 * An irregular quad. Real ash is angular and no two flakes match, so the
 * corners are jittered per mote and then held for its lifetime — regenerating
 * them per frame would make the flake boil.
 */
function makeShape(random: () => number): Float32Array {
  const shape = new Float32Array(8)
  const corners = [
    [-1, -0.7],
    [1, -1],
    [0.85, 0.9],
    [-0.9, 1],
  ]
  for (let i = 0; i < 4; i++) {
    shape[i * 2] = corners[i][0] * range(random, 0.6, 1.15)
    shape[i * 2 + 1] = corners[i][1] * range(random, 0.6, 1.15)
  }
  return shape
}

export function createField({ region, width, height, maxParticles }: FieldInit): ParticleField {
  const random = makeRandom(region === 'nav' ? 0x9e2a : 0x9e2b)
  const budget = regionBudget(region, maxParticles)

  let w = Math.max(1, width)
  let h = Math.max(1, height)

  const count =
    region === 'nav'
      ? countForArea(w, h, 240, budget, 6)
      : countForArea(w, h, 52, budget, 14)

  const makeMote = (): Mote => {
    // Soot is the minority. Dust is the weather; soot is the event in it.
    const kind = random() < 0.38 ? SOOT : DUST
    const soot = kind === SOOT
    return {
      kind,
      x: random() * w,
      // Seeded across the full height, not along the ceiling: at t=0 the field
      // is already falling, which is what makes the reduced-motion still frame
      // a composition rather than a row of dots.
      y: random() * h,
      // px/ms. Roughly 12–30 px/s for dust and 22–48 for soot: slow enough to
      // be settling rather than snowing, fast enough that a mote visibly
      // descends. The first pass ran dust at 6 px/s, which crossed the panel in
      // a minute and a half and read as suspended, not falling.
      fall: soot ? range(random, 0.022, 0.048) : range(random, 0.012, 0.03),
      bobAmp: soot ? range(random, 0.15, 0.35) : range(random, 0.25, 0.55),
      bobFreq: range(random, 0.0004, 0.0011),
      bobPhase: random() * Math.PI * 2,
      swayAmp: soot ? range(random, 0.004, 0.011) : range(random, 0.008, 0.022),
      swayFreq: range(random, 0.0006, 0.0018),
      swayPhase: random() * Math.PI * 2,
      drift: range(random, -0.0035, 0.0035),
      size: soot ? range(random, 1.6, 3.6) : range(random, 0.6, 1.5),
      alpha: soot ? range(random, 0.55, 0.9) : range(random, 0.14, 0.34),
      spin: random() * Math.PI * 2,
      spinSpeed: soot ? range(random, -0.0016, 0.0016) : 0,
      shape: soot ? makeShape(random) : new Float32Array(0),
    }
  }

  const motes: Mote[] = Array.from({ length: count }, makeMote)

  /** Alpha multiplier so nothing pops into or out of existence at an edge. */
  const edgeFade = (y: number): number => {
    if (y < EDGE_FADE) return Math.max(0, y / EDGE_FADE)
    if (y > h - EDGE_FADE) return Math.max(0, (h - y) / EDGE_FADE)
    return 1
  }

  return {
    resize(nextWidth, nextHeight) {
      const sx = nextWidth / w
      const sy = nextHeight / h
      w = Math.max(1, nextWidth)
      h = Math.max(1, nextHeight)
      for (const m of motes) {
        m.x *= sx
        m.y *= sy
      }
    },

    step(dt, elapsed) {
      for (const m of motes) {
        // The fall rate itself breathes, so descent is never linear even before
        // the sway displaces it sideways. `+=` — downward.
        const bob = 1 + Math.sin(elapsed * m.bobFreq + m.bobPhase) * m.bobAmp
        m.y += m.fall * bob * dt
        m.x += (Math.sin(elapsed * m.swayFreq + m.swayPhase) * m.swayAmp + m.drift) * dt
        m.spin += m.spinSpeed * dt

        // Fixed pool: a mote that falls out of the bottom is lifted back above
        // the top, never reallocated.
        if (m.y - m.size > h) {
          m.y = -m.size * 2
          m.x = random() * w
        }
        if (m.x + m.size < 0) m.x = w + m.size
        else if (m.x - m.size > w) m.x = -m.size
      }
    },

    draw(ctx) {
      for (const m of motes) {
        const a = m.alpha * edgeFade(m.y)
        if (a < 0.015) continue

        if (m.kind === DUST) {
          // Tarnished silver — text.primary, the palette's only light.
          ctx.fillStyle = `rgba(173, 171, 163, ${a.toFixed(3)})`
          ctx.beginPath()
          ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2)
          ctx.fill()
          continue
        }

        // Rotated by hand rather than with save/translate/rotate/restore: four
        // corners is less work than four context state changes per flake.
        const cos = Math.cos(m.spin)
        const sin = Math.sin(m.spin)
        ctx.beginPath()
        for (let i = 0; i < 4; i++) {
          const ox = m.shape[i * 2] * m.size
          const oy = m.shape[i * 2 + 1] * m.size
          const px = m.x + ox * cos - oy * sin
          const py = m.y + ox * sin + oy * cos
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        // Warm charcoal, not true black, and no outline.
        //
        // A black fill was tried first and fails twice: it is invisible on the
        // module area's #0A0B0F, and adding a lit rim to rescue it turned every
        // flake into a tiny hollow box — a wireframe, not a cinder. Soot on a
        // dark ground photographs as a grey flake anyway, and what separates it
        // from the dust here is not blackness but material: this is warm,
        // opaque and angular where dust is cool, faint and round.
        ctx.fillStyle = `rgba(52, 50, 47, ${a.toFixed(3)})`
        ctx.fill()
      }
    },
  }
}
