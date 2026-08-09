/**
 * Sepulchral containment frame — a nine-slice border image.
 *
 * `border-radius` can only ever produce one shape: a quarter-round. A
 * Victorian frame is a *moulding* — an outer line, a concentric inner line
 * returning into the corner, and a bead between them — which no amount of
 * radius tuning will give you. A nine-slice border image is the only way to
 * carry a fixed-size corner ornament onto boxes of arbitrary size without
 * distorting it: the four corner tiles are drawn 1:1 and only the straight
 * edges stretch, and a straight hairline stretches perfectly.
 *
 * Two constraints shape everything below:
 *
 *  - The corner ornament may only ever run *inward*. The element's own
 *    background is a rounded rectangle of RADIUS, and anything drawn outside
 *    that arc would have bare background showing behind it. Inward flourishes
 *    sit over the padding and are free.
 *
 *  - `border-image-width` is independent of `border-width`. Layout reserves
 *    1px; the ornament draws SLICE px over the padding box. Without that
 *    split, showing a 16px corner would mean a 16px border pushing all
 *    content inward.
 */

import type { ThemeFrame } from '../../types'

/** Tile size. The middle band is pure straight edge, which is what stretches. */
const SIZE = 56
/**
 * Corner tile size — feeds both border-image-slice and border-image-width.
 * Kept at 14 rather than 16 so that two opposing corners (28px) still fit
 * inside the shortest box the frame is used on: the one-row chat input, which
 * is 38px tall. Any larger and the two tiles overlap and shear.
 */
const SLICE = 14
/** Must match the border-radius applied alongside this image (--radius-lg). */
const RADIUS = 10
/** Hairline centred on the element's own boundary. */
const INSET = 0.5

const OUTER_R = RADIUS - INSET
/**
 * The returning inner moulding, concentric with the outer arc. Sized so the
 * channel between the two (OUTER_R - INNER_R = 4.5px) clears the bead on both
 * sides; any larger and the bead fouls one moulding or the other.
 */
const INNER_R = 5
/** Bead sits midway between the two mouldings, on the corner's bisector. */
const BEAD_R = 1.1
const DIAGONAL = Math.SQRT1_2

function n(value: number): string {
  return Number(value.toFixed(2)).toString()
}

/**
 * Each corner is the top-left ornament reflected into place, so the four are
 * congruent by construction rather than by careful re-typing.
 */
interface Corner {
  /** Centre of the corner's arcs. */
  cx: number
  cy: number
  /** Which way is "inward" along each axis: +1 or -1. */
  sx: number
  sy: number
}

const CORNERS: Corner[] = [
  { cx: RADIUS, cy: RADIUS, sx: 1, sy: 1 },
  { cx: SIZE - RADIUS, cy: RADIUS, sx: -1, sy: 1 },
  { cx: SIZE - RADIUS, cy: SIZE - RADIUS, sx: -1, sy: -1 },
  { cx: RADIUS, cy: SIZE - RADIUS, sx: 1, sy: -1 },
]

function cornerOrnament({ cx, cy, sx, sy }: Corner): string {
  // Ends of the inner arc: one on each axis through the corner centre.
  const ax = cx - sx * INNER_R
  const ay = cy
  const bx = cx
  const by = cy - sy * INNER_R

  // The outer moulding's position on those same two axes.
  const ox = cx - sx * (RADIUS - INSET) - sx * INSET
  const oy = cy - sy * (RADIUS - INSET) - sy * INSET

  // The inner arc must bow *towards* the corner so it stays concentric with
  // the outer moulding. Bowed the other way it cuts the corner off instead of
  // following it, and the ornament reads as a keyhole rather than a moulding.
  // Sweep flips with each reflection: mirroring once reverses arc direction.
  const sweep = sx * sy > 0 ? 1 : 0

  const beadR = (OUTER_R + INNER_R) / 2
  const beadX = cx - sx * beadR * DIAGONAL
  const beadY = cy - sy * beadR * DIAGONAL

  return (
    // Inner arc returning between the two axes.
    `%3Cpath d='M${n(ax)} ${n(ay)}A${n(INNER_R)} ${n(INNER_R)} 0 0 ${sweep} ${n(bx)} ${n(by)}' stroke-opacity='0.75'/%3E` +
    // Short ticks tying the inner moulding back to the outer line.
    `%3Cpath d='M${n(ox)} ${n(ay)}L${n(ax)} ${n(ay)}' stroke-opacity='0.6'/%3E` +
    `%3Cpath d='M${n(bx)} ${n(oy)}L${n(bx)} ${n(by)}' stroke-opacity='0.6'/%3E` +
    // The bead, on the bisector between the mouldings.
    `%3Ccircle cx='${n(beadX)}' cy='${n(beadY)}' r='${n(BEAD_R)}' stroke-opacity='0.85'/%3E`
  )
}

function buildSvg(stroke: string): string {
  const hex = stroke.replace('#', '%23')
  const a = INSET
  const b = SIZE - INSET
  const r = OUTER_R

  // Outer moulding: a rounded rectangle whose radius matches the
  // border-radius the element carries, so line and background coincide.
  let body =
    `%3Cpath d='M${n(a + r)} ${n(a)}` +
    `H${n(b - r)}A${n(r)} ${n(r)} 0 0 1 ${n(b)} ${n(a + r)}` +
    `V${n(b - r)}A${n(r)} ${n(r)} 0 0 1 ${n(b - r)} ${n(b)}` +
    `H${n(a + r)}A${n(r)} ${n(r)} 0 0 1 ${n(a)} ${n(b - r)}` +
    `V${n(a + r)}A${n(r)} ${n(r)} 0 0 1 ${n(a + r)} ${n(a)}Z'/%3E`

  for (const corner of CORNERS) body += cornerOrnament(corner)

  return (
    `%3Csvg xmlns='http://www.w3.org/2000/svg' width='${SIZE}' height='${SIZE}' ` +
    `viewBox='0 0 ${SIZE} ${SIZE}' fill='none' stroke='${hex}' stroke-width='1' ` +
    `stroke-linecap='round'%3E${body}%3C/svg%3E`
  )
}

function source(stroke: string): string {
  return `url("data:image/svg+xml,${buildSvg(stroke)}")`
}

let cached: ThemeFrame | null = null

/** Built once, on first use of the theme, then reused for every framed box. */
export function ornateFrame(): ThemeFrame {
  if (cached === null) {
    cached = {
      base: source('#8C8880'),
      // Oxblood, matching --border-focus, so a focused box lights its whole
      // moulding rather than only the flat border underneath it.
      focus: source('#C1495B'),
      slice: SLICE,
    }
  }
  return cached
}
