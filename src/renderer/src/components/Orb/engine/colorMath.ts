/** Shortest-path hue interpolation — wraps correctly across the 0/1 seam. */
export function lerpHue(current: number, target: number, factor: number): number {
  let delta = target - current
  delta -= Math.round(delta)
  let next = current + delta * factor
  next -= Math.floor(next)
  return next
}
