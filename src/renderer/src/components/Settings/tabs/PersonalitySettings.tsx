import { useState } from 'react'
import { Flame } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useToastStore } from '../../../stores/toastStore'
import { SettingRow } from '../controls/SettingRow'
import { Button } from '../../shared/Button'
import type { PersonalityMode } from '../../../../../shared/types'

const MODES: Array<{ value: PersonalityMode; label: string; labelJa: string }> = [
  { value: 'standard', label: 'Standard', labelJa: '標準' },
  { value: 'unbridled', label: 'Unbridled', labelJa: '無制限' },
]

function ModeSwitch({ value, onSelect }: { value: PersonalityMode; onSelect: (mode: PersonalityMode) => void }) {
  return (
    <div className="inline-flex rounded-md p-0.5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {MODES.map((m) => {
        const isActive = m.value === value
        return (
          <button
            key={m.value}
            onClick={() => onSelect(m.value)}
            className="px-3 py-1.5 rounded text-xs transition-colors"
            style={{
              background: isActive ? 'var(--reigan-gradient)' : 'transparent',
              color: isActive ? 'var(--text-on-accent)' : 'var(--text-muted)',
            }}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

export function PersonalitySettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const push = useToastStore((s) => s.push)
  const [pendingConfirm, setPendingConfirm] = useState(false)

  const handleSelect = (mode: PersonalityMode) => {
    if (mode === settings.personalityMode) return

    if (mode === 'unbridled' && !settings.unbridledModeAcknowledged) {
      setPendingConfirm(true)
      return
    }

    set('personalityMode', mode)
    push(mode === 'unbridled' ? 'Switched to Unbridled Mode' : 'Switched to Standard Mode', 'info')
  }

  const confirmUnbridled = () => {
    set('unbridledModeAcknowledged', true)
    set('personalityMode', 'unbridled')
    setPendingConfirm(false)
    push('Switched to Unbridled Mode', 'info')
  }

  return (
    <div className="space-y-6">
      <div>
        <SettingRow
          label="AI Personality"
          labelJa="性格モード"
          description="Standard keeps Shingan composed and professional. Unbridled allows profanity, roasting, and dark humor — accuracy stays the same either way."
          last
        >
          <ModeSwitch value={settings.personalityMode} onSelect={handleSelect} />
        </SettingRow>
      </div>

      {settings.personalityMode === 'unbridled' && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: 'color-mix(in srgb, var(--accent-primary) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)' }}
        >
          <Flame size={14} style={{ color: 'var(--reigan-primary)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Unbridled Mode is active. Switch back to Standard anytime.
          </span>
        </div>
      )}

      {pendingConfirm && (
        <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)' }}>
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Unbridled Mode enables profanity, roasting, and adult humor in AI responses. Shingan stays just as accurate and helpful — just with zero filter. You can switch back anytime.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setPendingConfirm(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={confirmUnbridled}>Enable</Button>
          </div>
        </div>
      )}
    </div>
  )
}
