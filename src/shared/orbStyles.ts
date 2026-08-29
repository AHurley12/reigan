/**
 * Orb style ids and their display names.
 *
 * The implementations live in the renderer (`orbRegistry.ts`) because each one
 * constructs DOM. Only the id → label half lives here, so the main process can
 * name the active orb without importing renderer code. `orbRegistry.ts`
 * `satisfies Record<OrbStyleId, OrbStyleDef>`, so adding a style there without
 * adding it here fails to compile.
 */
export const ORB_STYLE_LABELS = {
  nebula: 'Rose Nebula',
  cube: 'Cube',
  sphere: 'Sphere',
  helix: 'Helix',
  ai_orb: 'AI Orb',
} as const

export type OrbStyleId = keyof typeof ORB_STYLE_LABELS

export const DEFAULT_ORB_STYLE: OrbStyleId = 'nebula'

export function isOrbStyleId(v: unknown): v is OrbStyleId {
  return typeof v === 'string' && v in ORB_STYLE_LABELS
}
