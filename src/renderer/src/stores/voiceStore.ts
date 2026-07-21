import { create } from 'zustand'

interface OrbAudioData {
  amplitude: number
  bass: number
  mid: number
  high: number
}

interface VoiceStore {
  isActive: boolean
  transcript: string
  orbAudio: OrbAudioData
  setActive: (active: boolean) => void
  setTranscript: (text: string) => void
  setOrbAudio: (data: OrbAudioData) => void
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  isActive: false,
  transcript: '',
  orbAudio: { amplitude: 0, bass: 0, mid: 0, high: 0 },
  setActive: (isActive) => set({ isActive }),
  setTranscript: (transcript) => set({ transcript }),
  setOrbAudio: (orbAudio) => set({ orbAudio }),
}))
