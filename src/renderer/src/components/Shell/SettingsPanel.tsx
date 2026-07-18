import React, { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Check } from 'lucide-react'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useIPC } from '../../hooks/useIPC'
import { SectionHeader } from '../shared/SectionHeader'
import { Button } from '../shared/Button'

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen } = useAppStore()
  const { settings, updateSetting } = useSettingsStore()
  const ipc = useIPC()

  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settingsOpen) {
      ipc?.getSetting('anthropicApiKey').then((key) => {
        if (key) setApiKeyInput(key)
      })
    }
  }, [settingsOpen])

  const handleSaveKey = async () => {
    await ipc?.setSetting('anthropicApiKey', apiKeyInput)
    updateSetting('anthropicApiKey', apiKeyInput)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  if (!settingsOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={() => setSettingsOpen(false)}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 bottom-0 z-50 w-[400px] flex flex-col animate-slide-right"
        style={{
          background: 'var(--bg-surface)',
          borderLeft: '1px solid var(--border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4 shrink-0"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <SectionHeader en="Settings" ja="設定" />
          <button
            onClick={() => setSettingsOpen(false)}
            className="w-8 h-8 rounded-md flex items-center justify-center
              transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8">
          {/* API Key */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Anthropic API Key
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Required to activate REIGAN. Your key is stored locally.
              </p>
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  className="w-full bg-elevated rounded-md px-3 py-2 pr-10 text-sm
                    placeholder:text-txt-muted text-txt-primary
                    border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
                    font-mono transition-colors"
                />
                <button
                  onClick={() => setShowKey((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <Button size="sm" variant={saved ? 'primary' : 'ghost'} onClick={handleSaveKey}>
                {saved ? <Check size={14} /> : 'Save'}
              </Button>
            </div>
          </div>

          {/* Japanese Level */}
          <div className="space-y-3">
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                Japanese Display
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Controls ambient Japanese text throughout the UI.
              </p>
            </div>
            <div className="flex gap-2">
              {[
                { level: 0, label: 'Off', ja: 'オフ' },
                { level: 1, label: 'Ambient', ja: '環境' },
                { level: 2, label: 'Learning', ja: '学習' },
              ].map(({ level, label, ja }) => (
                <button
                  key={level}
                  onClick={() => updateSetting('japaneseLevel', level as 0 | 1 | 2)}
                  className={`flex-1 py-2 rounded-md text-xs transition-colors
                    ${settings.japaneseLevel === level
                      ? 'bg-reigan-primary/20 border border-reigan-primary/40 text-txt-primary'
                      : 'bg-elevated border border-[var(--border)] text-txt-muted hover:text-txt-secondary'
                    }`}
                >
                  <div>{label}</div>
                  <div className="font-kanji text-[10px] mt-0.5" style={{ color: 'var(--text-kanji)' }}>{ja}</div>
                </button>
              ))}
            </div>
          </div>

          {/* App info */}
          <div
            className="rounded-lg p-4 space-y-2"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="font-display font-semibold"
                style={{
                  background: 'var(--reigan-gradient)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                REIGAN 霊眼
              </span>
              <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>v0.1.0</span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              See beyond. Act within.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
