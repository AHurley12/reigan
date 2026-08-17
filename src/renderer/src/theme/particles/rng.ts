/**
 * mulberry32 — small, fast, and seeded, so a field's composition is identical
 * on every mount and a re-render never reshuffles the scene. Shared, because
 * the themes had started to carry a copy each.
 */
export function makeRandom(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Uniform in [min, max). */
export function range(random: () => number, min: number, max: number): number {
  return min + random() * (max - min)
}
