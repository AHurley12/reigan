/**
 * Hue (0–1) of a CSS colour, or null if the value isn't one this understands.
 * Accepts `#rgb`, `#rrggbb`, and `rgb()/rgba()`; alpha is ignored because the
 * orb only wants the hue anchor. Greys return 0 — a hue is meaningless without
 * saturation, and the caller's fallback is no better a guess.
 */
export function hueOf(css: string): number | null {
  const value = css.trim()
  let r: number, g: number, b: number

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1]
    const n = parseInt(h, 16)
    r = ((n >> 16) & 255) / 255
    g = ((n >> 8) & 255) / 255
    b = (n & 255) / 255
  } else {
    const fn = /^rgba?\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i.exec(value)
    if (!fn) return null
    r = +fn[1] / 255
    g = +fn[2] / 255
    b = +fn[3] / 255
  }

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma === 0) return 0

  let hue: number
  if (max === r) hue = ((g - b) / chroma) % 6
  else if (max === g) hue = (b - r) / chroma + 2
  else hue = (r - g) / chroma + 4

  hue /= 6
  return hue - Math.floor(hue)
}

/** Shortest-path hue interpolation — wraps correctly across the 0/1 seam. */
export function lerpHue(current: number, target: number, factor: number): number {
  let delta = target - current
  delta -= Math.round(delta)
  let next = current + delta * factor
  next -= Math.floor(next)
  return next
}
