import React, { useRef, useCallback } from 'react'
import { TitleBar } from './TitleBar'
import { NavBar } from '../Nav/NavBar'
import { ChatPanel } from '../Chat/ChatPanel'
import { TaskPanel } from '../Tasks/TaskPanel'
import { useAppStore } from '../../stores/appStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import type { AppModule } from '../../../../shared/types'

const PLACEHOLDER_MODULES: Partial<Record<AppModule, { en: string; ja: string; romaji: string }>> = {
  files:       { en: 'Files',       ja: 'ファイル',   romaji: 'fairu' },
  mail:        { en: 'Mail',        ja: 'メール',     romaji: 'meeru' },
  calendar:    { en: 'Calendar',    ja: 'カレンダー', romaji: 'karendaa' },
  automations: { en: 'Automations', ja: '自動化',     romaji: 'jidouka' },
  dev:         { en: 'Dev Tools',   ja: '開発',       romaji: 'kaihatsu' },
}

function PlaceholderModule({ module }: { module: AppModule }) {
  const info = PLACEHOLDER_MODULES[module]
  if (!info) return null
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
      <div
        className="text-8xl font-kanji"
        style={{ color: 'var(--text-kanji)', opacity: 0.12 }}
      >
        {info.ja}
      </div>
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-xl font-medium" style={{ color: 'var(--text-secondary)' }}>
          {info.en}
        </span>
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          Coming soon — 近日公開
        </span>
      </div>
    </div>
  )
}

export function AppShell() {
  const { activeModule } = useAppStore()
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  const focusChat = useCallback(() => {
    chatInputRef.current?.focus()
  }, [])

  useKeyboard(focusChat)

  const renderModule = () => {
    switch (activeModule) {
      case 'chat':
        return <ChatPanel />
      case 'tasks':
        return <TaskPanel />
      default:
        return <PlaceholderModule module={activeModule} />
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg-void)' }}>
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <NavBar />
        <main className="flex-1 overflow-hidden" style={{ background: 'var(--bg-void)' }}>
          {renderModule()}
        </main>
      </div>
    </div>
  )
}
