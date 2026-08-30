import type { FieldInit, ParticleField } from '../../particles/types'
import { countForArea, regionBudget } from '../../particles/types'
import { makeRandom, range } from '../../particles/rng'
import { responseFor, approach } from './petalResponse'

/**
 * Yozakura ambient field — falling petals.
 *
 * Ported out of the theme's full-viewport layer so the petals fall *behind* the
 * UI rather than in front of it. The physics is unchanged: terminal fall, a
 * lateral sway, and two independent rotations, the second of which turns the
 * petal edge-on twice a cycle so it flutters instead of tumbling like confetti.
 *
 * The skin's signature comes with it. While a response generates, the petals in
 * the module area accelerate and swirl toward the middle of that panel, so the
 * drift itself points at where the answer is arriving. The rail's petals do not
 * react — nothing is being written there, and a rail that stirred in sympathy
 * would be decoration pretending to be information.
 *
 * The low mist stays in Effects.tsx: it is atmosphere across the whole window,
 * not something falling inside a panel.
 */

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

/**
 * One petal: a base, a tip and two flanks closed with a pair of cubics, with a
 * cleft at the tip. Drawn in the petal's own space so the two rotations compose
 * as a transform rather than as trigonometry on every vertex.
 *
 * Scaling x by cos(roll) is the whole flutter — it turns the petal edge-on
 * twice a cycle, where it nearly vanishes and then opens out again.
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
  // thing separating the silhouette from a generic teardrop.
  ctx.lineTo(0, s * 0.3)
  ctx.lineTo(0, s * 0.5)
  ctx.bezierCurveTo(-s * 0.5, s * 0.52, -s * 0.62, -s * 0.2, 0, -s * 0.5)
  ctx.fill()

  ctx.restore()
}

export function createField({ region, width, height, maxParticles }: FieldInit): ParticleField {
  const random = makeRandom(region === 'nav' ? 0x5a4b : 0x5a4c)
  const budget = regionBudget(region, maxParticles)
  const reactive = region === 'main'

  let w = Math.max(1, width)
  let h = Math.max(1, height)

  const count =
    region === 'nav'
      ? countForArea(w, h, 150, budget, 5)
      : countForArea(w, h, 28, budget, 10)

  const petals: Petal[] = Array.from({ length: count }, () => ({
    x: random() * w,
    // Seeded across the full height, so at t=0 the field is already falling.
    y: random() * h,
    vx: 0,
    vy: 0,
    fall: range(random, 0.012, 0.034),
    swayAmp: range(random, 0.006, 0.02),
    swayFreq: range(random, 0.0009, 0.0025),
    swayPhase: random() * Math.PI * 2,
    spin: random() * Math.PI * 2,
    spinSpeed: range(random, -0.0006, 0.0006),
    roll: random() * Math.PI * 2,
    rollSpeed: range(random, 0.0009, 0.0031),
    // Smaller in the rail: a 62px column cannot carry a 12px petal without it
    // reading as a sticker.
    size: region === 'nav' ? range(random, 3.5, 6) : range(random, 5, 12),
    alpha: range(random, 0.4, 0.85),
    pale: random() < 0.35,
  }))

  // Eased toward the target set by `activity`, so a state change turns the
  // weather instead of cutting it.
  let pull = 0
  let calm = 1

  return {
    resize(nextWidth, nextHeight) {
      const sx = nextWidth / w
      const sy = nextHeight / h
      w = Math.max(1, nextWidth)
      h = Math.max(1, nextHeight)
      for (const p of petals) {
        p.x *= sx
        p.y *= sy
      }
    },

    step(dt, elapsed, activity) {
      const target = responseFor(activity)
      pull = approach(pull, reactive ? target.pull : 0, dt)
      calm = approach(calm, target.calm, dt)

      const speed = calm * (1 + pull * 1.6)
      const anchorX = w * 0.5
      const anchorY = h * 0.42

      for (const p of petals) {
        // Base drift: terminal fall plus a lateral sway, which is what keeps a
        // petal off a straight line down.
        const sway = Math.sin(elapsed * p.swayFreq + p.swayPhase) * p.swayAmp
        let ax = sway
        let ay = p.fall

        if (pull > 0.001) {
          const dx = anchorX - p.x
          const dy = anchorY - p.y
          const d = Math.hypot(dx, dy) || 1
          // Radial draw toward the response area plus a tangential component of
          // the same order — the tangent is what makes it a swirl rather than a
          // vacuum cleaner.
          ax += ((dx / d) * 0.85 + (-dy / d) * 0.55) * pull * 0.03
          ay += ((dy / d) * 0.85 + (dx / d) * 0.55) * pull * 0.03
        }

        p.vx += (ax * speed - p.vx) * Math.min(1, dt / 260)
        p.vy += (ay * speed - p.vy) * Math.min(1, dt / 260)
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.spin += p.spinSpeed * dt * speed
        p.roll += p.rollSpeed * dt * speed

        // Fixed pool: a petal that leaves the box is repositioned, never
        // reallocated.
        if (p.y - p.size > h) {
          p.y = -p.size * 2
          p.x = random() * w
          p.vx = 0
          p.vy = 0
        } else if (p.y + p.size < -h * 0.3) {
          p.y = h + p.size
        }
        if (p.x - p.size > w) p.x = -p.size
        else if (p.x + p.size < 0) p.x = w + p.size
      }
    },

    draw(ctx) {
      for (const p of petals) drawPetal(ctx, p)
    },
  }
}
