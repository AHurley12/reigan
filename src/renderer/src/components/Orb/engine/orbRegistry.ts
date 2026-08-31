import type { OrbState, AudioData } from './types'

/** Common surface every voice orb implementation exposes to VoiceOrb.tsx. */
export interface VoiceOrbEngine {
  setState(state: OrbState): void
  setAudioData(data: AudioData): void
  setThrottled(throttled: boolean): void
  dispose(): void
}

export type OrbFactory = (container: HTMLElement, particleCount: number) => VoiceOrbEngine

export interface OrbStyleDef {
  label: string
  labelJa?: string
  /** Pulls the implementation — and with it `three` — only when one is built. */
  load: () => Promise<OrbFactory>
}

/**
 * Registered voice orb styles, selectable in Settings → Voice.
 *
 * This module holds **metadata only**, and every implementation is behind a
 * dynamic `load()`. That separation is load-bearing, not tidiness: Settings →
 * Voice imports ORB_STYLES purely to label a dropdown, and while the engines
 * were imported statically here, that one import dragged all five of them —
 * and the 1,358 KB of `three` they share — into the startup chunk. Splitting
 * the orb column out of AppShell had almost no effect until this was fixed,
 * because Settings was pulling the same graph back in through the side door.
 *
 * A new orb needs an entry here and nothing else; VoiceOrb.tsx and the settings
 * plumbing stay untouched.
 */
export const ORB_STYLES: Record<string, OrbStyleDef> = {
  nebula: {
    label: 'Rose Nebula',
    labelJa: '薔薇星雲',
    load: async () => {
      const { ReiganOrb } = await import('./ReiganOrb')
      return (container, particleCount) => new ReiganOrb(container, particleCount)
    },
  },
  cube: {
    label: 'Cube',
    labelJa: '立方体',
    load: async () => {
      const { CubeOrb } = await import('./CubeOrb')
      return (container, particleCount) => new CubeOrb(container, particleCount)
    },
  },
  sphere: {
    label: 'Sphere',
    labelJa: '球体',
    load: async () => {
      const { SphereOrb } = await import('./SphereOrb')
      return (container, particleCount) => new SphereOrb(container, particleCount)
    },
  },
  helix: {
    label: 'Helix',
    labelJa: '螺旋',
    load: async () => {
      const { HelixOrb } = await import('./HelixOrb')
      return (container, particleCount) => new HelixOrb(container, particleCount)
    },
  },
  ai_orb: {
    label: 'AI Orb',
    labelJa: 'AIオーブ',
    load: async () => {
      const { AiOrb } = await import('./AiOrb')
      return (container, particleCount) => new AiOrb(container, particleCount)
    },
  },
}

export const DEFAULT_ORB_STYLE = 'nebula'
