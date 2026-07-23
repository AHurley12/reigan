import { useSettingsStore } from '../../stores/settingsStore'
import { hasKanji } from '../../i18n/kanji'
import { FuriganaText } from './FuriganaText'

interface Props {
  en: string
  ja: string
  romaji?: string
  className?: string
}

export function SectionHeader({ en, ja, romaji, className = '' }: Props) {
  const level = useSettingsStore((s) => s.settings.japaneseLevel)
  const showFurigana = useSettingsStore((s) => s.settings.showFurigana)
  const showRomaji = useSettingsStore((s) => s.settings.showRomaji)

  const withFurigana = level >= 2 && showFurigana && romaji && hasKanji(ja)

  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="font-display text-txt-primary font-medium tracking-wide">{en}</span>
      {level >= 1 && (
        <span className="font-body text-txt-kanji text-xs flex items-baseline gap-1.5">
          {withFurigana ? <FuriganaText text={ja} reading={romaji!} /> : ja}
          {showRomaji && romaji && !withFurigana && (
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>{romaji}</span>
          )}
        </span>
      )}
    </div>
  )
}
