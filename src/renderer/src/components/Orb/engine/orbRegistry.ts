import type { OrbState, AudioData } from './types'
import { ReiganOrb } from './ReiganOrb'
import { CubeOrb } from './CubeOrb'
import { SphereOrb } from './SphereOrb'
import { HelixOrb } from './HelixOrb'
import { AiOrb } from './AiOrb'

/** Common surface every voice orb implementation exposes to VoiceOrb.tsx. */
export interface VoiceOrbEngine {
  setState(state: OrbState): void
  setAudioData(data: AudioData): void
  setThrottled(throttled: boolean): void
  dispose(): void
}

export interface OrbStyleDef {
  label: string
  labelJa?: string
  create: (container: HTMLElement, particleCount: number) => VoiceOrbEngine
}

/**
 * Registered voice orb styles, selectable in Settings → Voice. Add a new
 * entry here to make another orb implementation switchable without touching
 * VoiceOrb.tsx or the settings plumbing.
 */
export const ORB_STYLES: Record<string, OrbStyleDef> = {
  nebula: {
    label: 'Rose Nebula',
    labelJa: '薔薇星雲',
    create: (container, particleCount) => new ReiganOrb(container, particleCount),
  },
  cube: {
    label: 'Cube',
    labelJa: '立方体',
    create: (container, particleCount) => new CubeOrb(container, particleCount),
  },
  sphere: {
    label: 'Sphere',
    labelJa: '球体',
    create: (container, particleCount) => new SphereOrb(container, particleCount),
  },
  helix: {
    label: 'Helix',
    labelJa: '螺旋',
    create: (container, particleCount) => new HelixOrb(container, particleCount),
  },
  ai_orb: {
    label: 'AI Orb',
    labelJa: 'AIオーブ',
    create: (container, particleCount) => new AiOrb(container, particleCount),
  },
}

export const DEFAULT_ORB_STYLE = 'nebula'
