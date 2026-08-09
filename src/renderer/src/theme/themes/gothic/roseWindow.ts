/**
 * Gothic Revival rose window, generated rather than hand-drawn.
 *
 * The previous memento-mori watermark was hand-authored SVG paths, and it
 * read as a cartoon because hand-placed control points can't hold the radial
 * symmetry that makes real tracery feel architectural. Everything here is
 * computed from polar coordinates, so the twelve lights are exactly
 * congruent and the whole figure is exactly symmetric — the quality the
 * previous attempt was missing.
 *
 * It also shares its vocabulary with the damask ground in ornament.css:
 * both are built from foils and quatrefoils, at different scales.
 */

const SIZE = 400
const C = SIZE / 2
/** Number of radiating lights. Twelve is the canonical rose count. */
const LIGHTS = 12

interface Point {
  x: number
  y: number
}

function polar(radius: number, angle: number): Point {
  return { x: C + radius * Math.cos(angle), y: C + radius * Math.sin(angle) }
}

function n(value: number): string {
  return value.toFixed(1)
}

function circle(cx: number, cy: number, r: number, opacity?: number): string {
  const o = opacity === undefined ? '' : ` stroke-opacity='${opacity}'`
  return `%3Ccircle cx='${n(cx)}' cy='${n(cy)}' r='${n(r)}'${o}/%3E`
}

/**
 * One light: a bay of the rose, bounded by two radial mullions and closed by
 * a pointed arch.
 *
 * The two earlier attempts both failed by giving the light a *fixed*
 * tangential width — first a pointed almond (twelve of those with a foil in
 * the middle read as eyes), then a narrow shaft with a round head (which read
 * as keyholes). Real tracery lights are angular: they fill most of their bay
 * and are separated only by a thin mullion, so their width grows with radius.
 * `halfAngle` rather than a half-width is the whole correction.
 */
function light(angle: number, base: number, spring: number, apexR: number, halfAngle: number): string {
  const p1 = polar(base, angle - halfAngle)
  const p2 = polar(spring, angle - halfAngle)
  const apex = polar(apexR, angle)
  const p3 = polar(spring, angle + halfAngle)
  const p4 = polar(base, angle + halfAngle)

  // Each half of the pointed arch, as a quadratic to the apex. The control
  // sits out near the mullion line so the curve leaves the springing
  // vertically and meets its twin at a true point rather than a dome.
  const haunch = (sign: number): Point => polar(spring + (apexR - spring) * 0.58, angle + sign * halfAngle * 0.92)
  const hA = haunch(-1)
  const hB = haunch(1)

  return (
    `%3Cpath d='M${n(p1.x)} ${n(p1.y)}L${n(p2.x)} ${n(p2.y)}` +
    `Q${n(hA.x)} ${n(hA.y)} ${n(apex.x)} ${n(apex.y)}` +
    `Q${n(hB.x)} ${n(hB.y)} ${n(p3.x)} ${n(p3.y)}` +
    `L${n(p4.x)} ${n(p4.y)}` +
    `A${n(base)} ${n(base)} 0 0 0 ${n(p1.x)} ${n(p1.y)}Z'/%3E`
  )
}

/** A quatrefoil: four foils on the cardinal points, the rose's core motif. */
function quatrefoil(radius: number, foil: number, rotation: number): string {
  let out = ''
  for (let i = 0; i < 4; i++) {
    const a = rotation + (i * Math.PI) / 2
    const p = polar(radius, a)
    out += circle(p.x, p.y, foil)
  }
  return out
}

function buildSvg(stroke: string): string {
  const hex = stroke.replace('#', '%23')
  let body = ''

  // Outer mouldings — a double ring is how tracery meets the wall.
  body += circle(C, C, 194)
  body += circle(C, C, 184, 0.55)

  // The twelve lights. Each fills 80% of its 30° bay; the remaining 20% is
  // the mullion between it and its neighbour.
  const BAY = (Math.PI * 2) / LIGHTS
  const BASE = 100
  const SPRING = 138
  const APEX = 178
  for (let i = 0; i < LIGHTS; i++) {
    // -90° so a light points true north rather than east.
    const angle = i * BAY - Math.PI / 2
    body += light(angle, BASE, SPRING, APEX, BAY * 0.4)
  }

  // Spandrel foils in the small triangles left between adjacent arch heads.
  for (let i = 0; i < LIGHTS; i++) {
    const angle = (i + 0.5) * BAY - Math.PI / 2
    const p = polar(162, angle)
    body += circle(p.x, p.y, 7, 0.6)
  }

  // Inner ring enclosing the core.
  body += circle(C, C, 96)
  body += circle(C, C, 88, 0.55)

  // A ring of six oculi between the core and the inner moulding.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2
    const p = polar(64, angle)
    body += circle(p.x, p.y, 17, 0.7)
  }

  // The core: a quatrefoil inside its own moulding.
  body += circle(C, C, 32, 0.8)
  body += quatrefoil(20, 13, -Math.PI / 2)

  return (
    `%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${SIZE} ${SIZE}' ` +
    `fill='none' stroke='${hex}' stroke-width='1.4' ` +
    `stroke-linecap='round' stroke-linejoin='round'%3E${body}%3C/svg%3E`
  )
}

let cached: string | null = null

/** CSS background-image value. Built once, on first selection of the theme. */
export function roseWindow(): string {
  if (cached === null) cached = `url("data:image/svg+xml,${buildSvg('#C6C3BA')}")`
  return cached
}
