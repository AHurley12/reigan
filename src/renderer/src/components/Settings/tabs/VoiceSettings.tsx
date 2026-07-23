import { useSettingsStore } from '../../../stores/settingsStore'
import { SettingRow } from '../controls/SettingRow'
import { Toggle } from '../controls/Toggle'
import { Select } from '../controls/Select'
import { Slider } from '../controls/Slider'
import { ApiKeyField } from '../controls/ApiKeyField'

const VOICE_OPTIONS = [
  { value: 'pNInz6obpgDQGcFmaJgB', label: 'Adam' },
  { value: 'ErXwobaYiN019PkySvjV', label: 'Antoni' },
  { value: 'TxGEqnHWrfWFTfGW9XjX', label: 'Josh' },
  { value: 'yoZ06aMxZJJ28mfd3POQ', label: 'Sam' },
]

const INPUT_MODE_OPTIONS = [
  { value: 'true', label: 'Push-to-talk' },
  { value: 'false', label: 'Toggle' },
]

export function VoiceSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)

  return (
    <div className="space-y-6">
      <div>
        <SettingRow label="Voice enabled" labelJa="音声有効">
          <Toggle checked={settings.voiceEnabled} onChange={(v) => set('voiceEnabled', v)} />
        </SettingRow>
        <SettingRow label="Shingan voice" labelJa="音声選択">
          <Select value={settings.voiceId} options={VOICE_OPTIONS} onChange={(v) => set('voiceId', v)} />
        </SettingRow>
        <SettingRow label="Input mode" labelJa="入力モード" description="Ctrl+Shift+Space starts/stops listening from anywhere." last>
          <Select
            value={String(settings.pushToTalk)}
            options={INPUT_MODE_OPTIONS}
            onChange={(v) => set('pushToTalk', v === 'true')}
          />
        </SettingRow>
      </div>

      <div>
        <SettingRow label="Stability" labelJa="安定性" description="Higher = more consistent. Lower = more expressive.">
          <Slider min={0} max={1} step={0.05} value={settings.ttsStability} onChange={(v) => set('ttsStability', v)} formatLabel={(v) => v.toFixed(2)} />
        </SettingRow>
        <SettingRow label="Similarity" labelJa="類似度" description="How closely the output matches the reference voice." last>
          <Slider min={0} max={1} step={0.05} value={settings.ttsSimilarity} onChange={(v) => set('ttsSimilarity', v)} formatLabel={(v) => v.toFixed(2)} />
        </SettingRow>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Deepgram API Key</p>
          <ApiKeyField settingKey="deepgramApiKey" placeholder="Deepgram API key" />
        </div>
        <div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>ElevenLabs API Key</p>
          <ApiKeyField settingKey="elevenLabsApiKey" placeholder="ElevenLabs API key" />
        </div>
      </div>
    </div>
  )
}
