import { useState } from 'react'
import { X } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { HankoMark } from '../shared/HankoMark'
import { SETTINGS_TABS } from '../Settings/settingsRegistry'
import { APP_VERSION } from '../../../../shared/constants'

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen } = useAppStore()
  const [activeTab, setActiveTab] = useState(SETTINGS_TABS[0].id)

  if (!settingsOpen) return null

  const active = SETTINGS_TABS.find((t) => t.id === activeTab) ?? SETTINGS_TABS[0]
  const ActiveComponent = active.component

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 animate-fade-in"
        onClick={() => setSettingsOpen(false)}
      />

      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[460px] flex animate-slide-right"
        style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', boxShadow: '-12px 0 40px rgba(0,0,0,0.4)' }}
      >
        {/* Tab rail */}
        <div className="w-[140px] shrink-0 flex flex-col py-4" style={{ background: 'var(--bg-void)', borderRight: '1px solid var(--border)' }}>
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon
            const isActive = tab.id === activeTab
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="relative text-left px-3 py-2.5 mx-1 rounded-[3px] transition-colors duration-fast"
                style={{
                  background: isActive ? 'rgba(216, 67, 42, 0.14)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {isActive && (
                  <span
                    className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                    style={{ background: 'var(--reigan-primary)' }}
                  />
                )}
                <div className="flex items-center gap-2">
                  <Icon size={14} />
                  <span className="text-[13px]" style={{ fontFamily: 'var(--font-display)' }}>{tab.labelEn}</span>
                </div>
                <span className="text-[10px] font-kanji ml-5 block mt-0.5" style={{ color: 'var(--text-kanji)' }}>{tab.labelJa}</span>
              </button>
            )
          })}

          <div className="mt-auto px-3 py-2 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            v{APP_VERSION}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div
            className="sticky top-0 flex items-center justify-between px-6 py-4 shrink-0 z-10"
            style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2.5">
              <HankoMark size={26} />
              <div className="flex flex-col">
                <span className="text-sm font-medium tracking-wide" style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>SETTINGS</span>
                <span className="text-[11px] font-kanji" style={{ color: 'var(--text-kanji)' }}>設定</span>
              </div>
            </div>
            <button
              onClick={() => setSettingsOpen(false)}
              className="w-8 h-8 rounded-md flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <ActiveComponent />
          </div>
        </div>
      </div>
    </>
  )
}
