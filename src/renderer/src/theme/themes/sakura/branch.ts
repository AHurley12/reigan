/**
 * Ink-wash (sumi-e) cherry branch, generated rather than hand-drawn.
 *
 * The lesson from gothic's watermark applies here directly: hand-authored SVG
 * paths read as clip-art, because a person placing control points by eye cannot
 * hold the one property that makes the figure convincing. For a rose window
 * that property was radial symmetry. For a brush stroke it is the *width
 * profile* — a real sumi-e bough is thick where the brush lands and tapers to
 * nothing where it lifts, and it is that taper, not the curve, that reads as
 * ink on paper.
 *
 * So nothing here is stroked. Boughs are filled polygons built by walking a
 * Catmull-Rom spline through a handful of anchor points, offsetting each sample
 * along its normal by a width that decays toward the tip, and closing the loop
 * back down the other side.
 *
 * A spline through anchors rather than a single cubic, because the first
 * attempt used one cubic per bough and the result read as crossed sticks: one
 * cubic cannot bend twice, so every bough came out effectively straight, and
 * straightness is the thing that stops a branch looking like a branch. Anchors
 * also let a fork start *on* the parent curve instead of beside it, which is
 * what removed the X where two separate strokes used to cross.
 *
 * Painted at `--theme-watermark-opacity` behind the chat surface. On the night
 * ground the branch is lit rather than silhouetted — paper-tone ink catching
 * lantern light, with the blossoms in rose — because a black branch on a
 * plum-black ground is an invisible one.
 */

const W = 660
const H = 420

/** Paper-tone ink for the wood, lantern rose for the blossoms. */
const INK = '#E8DFD6'
const BLOSSOM = '#E39AA8'

interface Point {
  x: number
  y: number
}

/** Deterministic, so the figure is identical on every call and every launch. */
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

function n(value: number): string {
  return value.toFixed(1)
}

/** Wraps generated path data into an element. Every generator below returns a
    bare `d` string, so this is the only place geometry becomes markup. */
function path(d: string): string {
  return `<path d="${d}"/>`
}

/** Catmull-Rom through p1→p2, with p0/p3 as the neighbouring anchors. */
function catmull(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const t2 = t * t
  const t3 = t2 * t
  return {
    x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
    y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
  }
}

/** Samples a spline through `anchors`, endpoints duplicated so the curve
    actually reaches them. */
function spline(anchors: Point[], per = 12): Point[] {
  const a = [anchors[0], ...anchors, anchors[anchors.length - 1]]
  const out: Point[] = []
  for (let i = 0; i < a.length - 3; i++) {
    const last = i === a.length - 4
    for (let j = 0; j < per + (last ? 1 : 0); j++) {
      out.push(catmull(a[i], a[i + 1], a[i + 2], a[i + 3], j / per))
    }
  }
  return out
}

/**
 * A brush stroke along a sampled centreline: each sample offset along its
 * normal by a half-width decaying from `w0` to `w1`.
 *
 * The decay is `t^1.6` rather than linear because a lifting brush loses contact
 * slowly and then all at once — a linear taper produces a wedge, which reads as
 * a triangle rather than as a stroke.
 */
function taper(points: Point[], w0: number, w1: number): string {
  const left: string[] = []
  const right: string[] = []

  for (let i = 0; i < points.length; i++) {
    const t = i / (points.length - 1)
    const p = points[i]
    const q = points[Math.min(i + 1, points.length - 1)]
    const r = points[Math.max(i - 1, 0)]
    const dx = q.x - r.x
    const dy = q.y - r.y
    const len = Math.hypot(dx, dy) || 1
    const w = (w0 + (w1 - w0) * Math.pow(t, 1.6)) / 2
    left.push(`${n(p.x - (dy / len) * w)} ${n(p.y + (dx / len) * w)}`)
    right.push(`${n(p.x + (dy / len) * w)} ${n(p.y - (dx / len) * w)}`)
  }

  right.reverse()
  return `M${left.join('L')}L${right.join('L')}Z`
}

/**
 * A five-petal blossom, each petal a wide rounded lobe with a cleft tip.
 *
 * Built in the petal's own frame — `u` along its axis, `v` across it — so the
 * outline is written once in readable proportions and rotated into place. The
 * earlier version offset control points by trigonometry per vertex and produced
 * five thin spikes: an asterisk, not a flower. The cleft is a real dip between
 * two tip lobes rather than a doubled-back line, which is what the first
 * attempt drew (a zero-area spur that rendered as a spike).
 */
function blossom(cx: number, cy: number, r: number, rotation: number, random: () => number): string {
  const parts: string[] = []

  for (let i = 0; i < 5; i++) {
    const a = rotation + (i / 5) * Math.PI * 2 + (random() - 0.5) * 0.14
    const len = r * (0.94 + random() * 0.14)
    const wide = len * 0.58
    const ux = Math.cos(a)
    const uy = Math.sin(a)
    const vx = -Math.sin(a)
    const vy = Math.cos(a)
    /** along, across → absolute. */
    const P = (u: number, v: number): string =>
      `${n(cx + ux * len * u + vx * wide * v)} ${n(cy + uy * len * u + vy * wide * v)}`

    parts.push(
      `M${P(0.06, 0)}` +
        // out along one flank to the first tip lobe
        `C${P(0.3, -0.95)} ${P(0.82, -0.9)} ${P(0.95, -0.3)}` +
        // the cleft: a dip back toward the centre between the two lobes
        `Q${P(0.84, 0)} ${P(0.95, 0.3)}` +
        // and back down the other flank
        `C${P(0.82, 0.9)} ${P(0.3, 0.95)} ${P(0.06, 0)}Z`
    )
  }

  return parts.join('')
}

/** One loose petal, the same lobe without the cleft, for the few in the air. */
function looseParticle(cx: number, cy: number, r: number, a: number): string {
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  const vx = -Math.sin(a)
  const vy = Math.cos(a)
  const P = (u: number, v: number): string =>
    `${n(cx + ux * r * u + vx * r * 0.6 * v)} ${n(cy + uy * r * u + vy * r * 0.6 * v)}`
  return `M${P(-0.9, 0)}C${P(-0.3, -1)} ${P(0.6, -0.9)} ${P(1, 0)}C${P(0.6, 0.9)} ${P(-0.3, 1)} ${P(-0.9, 0)}Z`
}

function build(): string {
  const random = makeRandom(0x2b10550)

  const wood: string[] = []
  const flowers: string[] = []
  const loose: string[] = []

  // Main bough: in off the top-right corner, dipping as it crosses the frame
  // and lifting again at the tip. Five anchors, because the bend has to reverse
  // once — that reversal is most of what reads as "branch" rather than "stick".
  const mainAnchors: Point[] = [
    { x: W + 50, y: 30 },
    { x: W * 0.76, y: 82 },
    { x: W * 0.5, y: 104 },
    { x: W * 0.28, y: 158 },
    { x: W * 0.08, y: 246 },
  ]
  const main = spline(mainAnchors, 16)
  wood.push(taper(main, 27, 4))

  // The second bough forks *off* the first rather than entering the frame
  // beside it. Sharing a root is what makes the pair read as one tree.
  const forkAt = main[Math.floor(main.length * 0.26)]
  const forkAnchors: Point[] = [
    forkAt,
    { x: W * 0.68, y: 176 },
    { x: W * 0.62, y: 254 },
    { x: W * 0.5, y: 336 },
  ]
  const fork = spline(forkAnchors, 14)
  wood.push(taper(fork, 13, 3))

  /**
   * A twig off a parent centreline, curved rather than straight: the midpoint
   * is pushed off the chord so even a 60px shoot has a bend in it.
   */
  const twig = (parent: Point[], at: number, dir: number, len: number, w: number): Point => {
    const root = parent[Math.floor(parent.length * at)]
    const angle = (dir > 0 ? 0.62 : -0.72) + (random() - 0.5) * 0.4
    const away = Math.PI - 0.35 + angle
    const tip = {
      x: root.x + Math.cos(away) * len,
      y: root.y + Math.sin(away) * len * (dir > 0 ? 1 : 1.1),
    }
    const mid = {
      x: (root.x + tip.x) / 2 - dir * len * 0.16,
      y: (root.y + tip.y) / 2 - dir * len * 0.2,
    }
    wood.push(taper(spline([root, mid, tip], 10), w, 1.1))
    return tip
  }

  const clusters: Point[] = [
    twig(main, 0.34, 1, 74, 7),
    twig(main, 0.5, -1, 60, 6),
    twig(main, 0.68, 1, 66, 5.5),
    twig(main, 0.84, -1, 48, 4.5),
    twig(fork, 0.45, -1, 52, 5),
    twig(fork, 0.76, 1, 44, 4),
  ]

  // Blossoms cluster at the twig tips, where a real branch flowers.
  for (const tip of clusters) {
    const count = 2 + Math.floor(random() * 3)
    for (let i = 0; i < count; i++) {
      const cx = tip.x + (random() - 0.5) * 42
      const cy = tip.y + (random() - 0.5) * 38
      flowers.push(blossom(cx, cy, 11 + random() * 6, random() * Math.PI * 2, random))
    }
  }
  // Plus a few singles along the main bough, so the flowering is not confined
  // to the ends.
  for (const t of [0.44, 0.62, 0.8]) {
    const p = main[Math.floor(main.length * t)]
    flowers.push(
      blossom(p.x + (random() - 0.5) * 30, p.y - 20 - random() * 14, 10 + random() * 4, random() * Math.PI * 2, random)
    )
  }

  // Three petals already loose in the air, tying the still figure to the
  // ambient layer falling in front of it.
  for (let i = 0; i < 3; i++) {
    loose.push(
      looseParticle(
        W * (0.22 + random() * 0.42),
        H * (0.62 + random() * 0.3),
        7 + random() * 4,
        random() * Math.PI * 2
      )
    )
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<g fill="${INK}" fill-opacity="0.9">${wood.map(path).join('')}</g>` +
    `<g fill="${BLOSSOM}" fill-opacity="0.85">${flowers.map(path).join('')}</g>` +
    `<g fill="${BLOSSOM}" fill-opacity="0.55">${loose.map(path).join('')}</g>` +
    `</svg>`

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

let cached: string | null = null

/**
 * Lazy and cached, matching the `watermark` contract: nothing is built for a
 * skin the user never selects, and re-selecting sakura costs one string read.
 */
export function inkBranch(): string {
  if (cached === null) cached = build()
  return cached
}
