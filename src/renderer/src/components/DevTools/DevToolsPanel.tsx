import { Suspense, useState } from 'react'
import { DEVTOOLS_SECTIONS } from './devtoolsRegistry'
import { SectionHeader } from '../shared/SectionHeader'
import { useSettingsStore } from '../../stores/settingsStore'

/**
 * The Dev Tools tab.
 *
 * Only the active sub-section is mounted — each is a lazy chunk, so an unused
 * view costs nothing at startup and its polling (the localhost watcher, most
 * notably) cannot run while another section is open.
 */
export function DevToolsPanel() {
  const [activeId, setActiveId] = useState(DEVTOOLS_SECTIONS[0].id)
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)

  const active = DEVTOOLS_SECTIONS.find((s) => s.id === activeId) ?? DEVTOOLS_SECTIONS[0]
  const ActiveComponent = active.component

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <SectionHeader en="Dev Tools" ja="開発" romaji="kaihatsu" />

      <div className="flex items-center gap-1 px-4 pb-2 shrink-0">
        {DEVTOOLS_SECTIONS.map((section) => {
          const Icon = section.icon
          const isActive = section.id === activeId
          return (
            <button
              key={section.id}
              onClick={() => setActiveId(section.id)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm text-xs transition-colors"
              style={{
                background: isActive
                  ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)'
                  : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                border: `1px solid ${isActive ? 'var(--reigan-primary)' : 'transparent'}`,
              }}
            >
              <Icon size={13} />
              {section.labelEn}
              {japaneseLevel >= 1 && (
                <span className="font-kanji" style={{ color: 'var(--text-kanji)', opacity: 0.7 }}>
                  {section.labelJa}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden px-4 pb-4">
        <Suspense
          fallback={
            <div className="flex flex-col gap-2 pt-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="h-9 rounded-sm animate-pulse"
                  style={{ background: 'var(--bg-elevated)', opacity: 1 - i * 0.15 }}
                />
              ))}
            </div>
          }
        >
          {/* Keyed so switching sections remounts rather than reusing state
              from a different view's tree. */}
          <ActiveComponent key={active.id} />
        </Suspense>
      </div>
    </div>
  )
}
