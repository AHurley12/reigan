import { useSettingsStore } from '../../../stores/settingsStore'
import { useSystemPrefersReducedMotion } from '../../../hooks/useReducedMotion'
import { SettingRow } from '../controls/SettingRow'
import { Toggle } from '../controls/Toggle'
import { Select } from '../controls/Select'
import { ApiKeyField } from '../controls/ApiKeyField'
import { Slider } from '../controls/Slider'
import {
  MAX_TEMPERATURE,
  MIN_TEMPERATURE,
  MIN_THINKING_BUDGET,
  MODELS,
  resolveModel,
} from '../../../../../shared/models'
import type { MotionPreference } from '../../../../../shared/types'

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
  const systemReduces = useSystemPrefersReducedMotion()
  const activeModel = resolveModel(settings.model)
  // Opus 5 and Sonnet 5 think adaptively and have thinking on by default; the
  // toggle cannot honestly report them as off.
  const alwaysThinks = !activeModel.acceptsSampling && activeModel.thinkingMode === 'adaptive'

  const MOTION_OPTIONS = [
    {
      value: 'system',
      // Names what the machine is actually reporting. This is the whole reason
      // the row is a menu and not a switch: on a machine that reduces motion,
      // a switch labelled "Reduced motion" reads as off while everything in the
      // app stays still, and there is nothing on screen to explain why.
      label: `Match system — ${systemReduces ? 'reduced' : 'full'}`,
      labelJa: 'システム設定',
    },
    { value: 'reduce', label: 'Reduced', labelJa: 'モーション低減' },
    { value: 'full', label: 'Full', labelJa: 'フルモーション' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Anthropic API Key</p>
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Required to activate Shingan. Stored locally.</p>
        <ApiKeyField settingKey="anthropicApiKey" placeholder="sk-ant-..." />
      </div>

      <div>
        <SettingRow
          label="Model"
          labelJa="モデル"
          description={activeModel.hint}
        >
          <Select
            value={settings.model}
            options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
            onChange={(v) => set('model', v)}
          />
        </SettingRow>

        <SettingRow
          label="Extended thinking"
          labelJa="熟考"
          description={
            alwaysThinks
              ? `${activeModel.label} thinks on every turn and decides how much for itself, so this cannot be switched off.`
              : 'Lets the model reason at length before answering. Slower, and the thinking tokens are billed.'
          }
        >
          <Toggle
            checked={alwaysThinks || settings.thinkingEnabled}
            onChange={(v) => set('thinkingEnabled', v)}
            disabled={alwaysThinks}
          />
        </SettingRow>

        {/* Only the older manual mode takes a budget. On adaptive models the
            model chooses the depth itself, and sending a budget is a 400. */}
        {activeModel.thinkingMode === 'budget' && settings.thinkingEnabled && (
          <SettingRow
            label="Thinking budget"
            labelJa="思考予算"
            description="How many tokens the model may spend thinking before it answers."
          >
            <Slider
              min={MIN_THINKING_BUDGET}
              max={32_000}
              step={1024}
              value={settings.thinkingBudget}
              onChange={(v) => set('thinkingBudget', v)}
              formatLabel={(v) => `${v.toLocaleString()}`}
            />
          </SettingRow>
        )}

        <SettingRow
          label="Temperature"
          labelJa="温度"
          description={
            !activeModel.acceptsSampling
              ? `${activeModel.label} rejects temperature outright — prompt for the tone you want instead.`
              : settings.thinkingEnabled && activeModel.thinkingMode === 'budget'
                ? 'Fixed while extended thinking is on — the API requires the default.'
                : 'Lower is more focused, higher more varied. Default leaves it to the model.'
          }
          last
        >
          <div className="flex items-center gap-2">
            <button
              disabled={!activeModel.acceptsSampling}
              onClick={() => set('temperature', settings.temperature === null ? 1 : null)}
              className="px-2 py-1 rounded-sm text-[11px] transition-colors shrink-0"
              style={{
                border: '1px solid var(--border)',
                color: settings.temperature === null ? 'var(--text-primary)' : 'var(--text-muted)',
                background:
                  settings.temperature === null
                    ? 'color-mix(in srgb, var(--accent-primary) 14%, transparent)'
                    : 'transparent',
              }}
            >
              Default
            </button>
            {activeModel.acceptsSampling && settings.temperature !== null && (
              <Slider
                min={MIN_TEMPERATURE}
                max={MAX_TEMPERATURE}
                step={0.05}
                value={settings.temperature}
                onChange={(v) => set('temperature', v)}
                formatLabel={(v) => v.toFixed(2)}
              />
            )}
          </div>
        </SettingRow>
      </div>

      <div>
        <SettingRow
          label="Motion"
          labelJa="モーション"
          description="Reducing motion stills the theme's ambient particles and disables the nav stamp morph, task-complete stamp, and orb bloom/auto-rotate. Choose Full to keep them running even when the system asks for less."
        >
          <Select
            value={settings.motion}
            options={MOTION_OPTIONS}
            onChange={(v) => set('motion', v as MotionPreference)}
          />
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
