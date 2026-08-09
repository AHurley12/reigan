import { useSettingsStore } from '../../../stores/settingsStore'
import { SettingRow } from '../controls/SettingRow'
import { Toggle } from '../controls/Toggle'
import { ApiKeyField } from '../controls/ApiKeyField'

const SHORTCUTS = [
  { action: 'Focus chat', keys: 'Ctrl+/' },
  { action: 'Open settings', keys: 'Ctrl+,' },
  { action: 'Switch module', keys: 'Ctrl+1–7' },
  { action: 'Push-to-talk', keys: 'Ctrl+Shift+Space' },
  { action: 'Toggle personality mode', keys: 'Ctrl+Shift+U' },
  { action: 'Close panel', keys: 'Esc' },
]

export function GeneralSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Anthropic API Key</p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Required to activate Shingan. Stored locally.</p>
        <ApiKeyField settingKey="anthropicApiKey" placeholder="sk-ant-..." />
      </div>

      <div>
        <SettingRow label="Reduced motion" labelJa="モーション低減" description="Disables the nav stamp morph, task-complete stamp, and orb bloom/auto-rotate.">
          <Toggle checked={settings.reducedMotion} onChange={(v) => set('reducedMotion', v)} />
        </SettingRow>
        <SettingRow label="Show orb column" labelJa="オーブ表示" description="Hides the right column entirely for a wider chat/task view." last>
          <Toggle checked={settings.showOrbColumn} onChange={(v) => set('showOrbColumn', v)} />
        </SettingRow>
      </div>

      <div>
        <p className="text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Shortcuts</p>
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {SHORTCUTS.map((s, i) => (
            <div
              key={s.action}
              className="flex items-center justify-between px-3 py-2 text-xs"
              style={{ borderBottom: i < SHORTCUTS.length - 1 ? '1px solid var(--border)' : 'none', background: 'var(--bg-elevated)' }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>{s.action}</span>
              <span className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>{s.keys}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
