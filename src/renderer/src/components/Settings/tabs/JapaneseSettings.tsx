import { useSettingsStore } from '../../../stores/settingsStore'
import { SettingRow } from '../controls/SettingRow'
import { Toggle } from '../controls/Toggle'
import { Select } from '../controls/Select'
import type { JapaneseLevel } from '../../../../../shared/types'

const LEVEL_OPTIONS = [
  { value: '0', label: 'Off', labelJa: 'オフ' },
  { value: '1', label: 'Ambient', labelJa: '環境' },
  { value: '2', label: 'Learning', labelJa: '学習' },
]

const LEVEL_DESCRIPTIONS: Record<JapaneseLevel, string> = {
  0: 'All ambient Japanese text hidden. The brand mark still shows.',
  1: 'Section headers, nav, and status labels show Japanese alongside English.',
  2: 'Chrome labels also get furigana readings and romaji tooltips.',
}

export function JapaneseSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const level = settings.japaneseLevel

  return (
    <div className="space-y-1">
      <SettingRow label="Japanese level" labelJa="日本語レベル" description={LEVEL_DESCRIPTIONS[level]}>
        <Select
          value={String(level)}
          options={LEVEL_OPTIONS}
          onChange={(v) => set('japaneseLevel', Number(v) as JapaneseLevel)}
        />
      </SettingRow>
      <SettingRow
        label="Show furigana"
        labelJa="ふりがな表示"
        description={level < 2 ? 'Requires Learning level.' : 'Reading aids above kanji in app chrome.'}
      >
        <Toggle checked={settings.showFurigana && level >= 2} onChange={(v) => set('showFurigana', v)} />
      </SettingRow>
      <SettingRow
        label="Show romaji"
        labelJa="ローマ字表示"
        description={level < 1 ? 'Requires Ambient level.' : 'Romanized pronunciation in tooltips.'}
        last
      >
        <Toggle checked={settings.showRomaji && level >= 1} onChange={(v) => set('showRomaji', v)} />
      </SettingRow>
    </div>
  )
}
