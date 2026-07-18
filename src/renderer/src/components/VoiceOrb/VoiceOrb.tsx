import React from 'react'
import { useAppStore } from '../../stores/appStore'

export function VoiceOrb() {
  const { reiganState } = useAppStore()
  const isActive = reiganState !== 'idle'

  return (
    <div
      className={`w-orb h-orb rounded-full flex items-center justify-center mx-auto
        ${!isActive ? 'animate-pulse-idle' : 'animate-pulse'}`}
      style={{
        background: 'radial-gradient(circle at center, rgba(124, 58, 237, 0.6) 0%, rgba(0, 212, 255, 0.2) 40%, transparent 70%)',
        boxShadow: isActive ? 'var(--reigan-glow), var(--reigan-glow-cyan)' : 'var(--reigan-glow)',
      }}
    >
      <div
        className="w-12 h-12 rounded-full"
        style={{
          background: 'radial-gradient(circle at 40% 40%, rgba(167, 139, 250, 0.8), rgba(124, 58, 237, 0.4))',
        }}
      />
    </div>
  )
}
