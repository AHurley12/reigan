import React, { Suspense, lazy, useRef, useCallback, useEffect } from 'react'
import { TitleBar } from './TitleBar'
import { NavBar } from '../Nav/NavBar'
import { ChatPanel } from '../Chat/ChatPanel'
import { TaskPanel } from '../Tasks/TaskPanel'
import { CalendarPanel } from '../Calendar/CalendarPanel'
import { MailPanel } from '../Mail/MailPanel'
import { FilesPanel } from '../Files/FilesPanel'
import { PerformancePanel } from '../Performance/PerformancePanel'
import { AutomationsPanel } from '../Automations/AutomationsPanel'
import { OrbColumn } from '../Orb/OrbColumn'
import { ToastStack } from '../shared/Toast'
import { ApprovalDialog } from '../Approvals/ApprovalDialog'
import { useAppStore } from '../../stores/appStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToastStore } from '../../stores/toastStore'
import { useJobAlertStore, alertVariant } from '../../stores/jobAlertStore'
import { useKeyboard } from '../../hooks/useKeyboard'
import type { AppModule } from '../../../../shared/types'

/**
 * Lazy: the Dev Tools tree (six views plus its virtual list) must not join the
 * renderer's single 2.5MB startup chunk, which already dominates cold start.
 */
const DevToolsPanel = lazy(() =>
  import('../DevTools/DevToolsPanel').then((m) => ({ default: m.DevToolsPanel }))
)

const PLACEHOLDER_MODULES: Partial<Record<AppModule, { en: string; ja: string; romaji: string }>> = {
  automations: { en: 'Automations', ja: '自動化',     romaji: 'jidouka' },
}

function PlaceholderModule({ module }: { module: AppModule }) {
  const info = PLACEHOLDER_MODULES[module]
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)
  if (!info) return null
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 select-none">
      {japaneseLevel >= 1 && (
        <div
          className="text-8xl font-kanji"
          style={{ color: 'var(--text-kanji)', opacity: 0.12 }}
        >
          {info.ja}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <span className="font-display text-xl font-medium" style={{ color: 'var(--text-secondary)' }}>
          {info.en}
        </span>
        <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
          Coming soon{japaneseLevel >= 1 ? ' — 近日公開' : ''}
        </span>
      </div>
    </div>
  )
}

export function AppShell() {
  const { activeModule } = useAppStore()
  const showOrbColumn = useSettingsStore((s) => s.settings.showOrbColumn)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)

  const focusChat = useCallback(() => {
    chatInputRef.current?.focus()
  }, [])

  useKeyboard(focusChat)

  // Subscribed at the shell, not in the Jobs view: a 04:00 failure has to be
  // captured whichever tab happens to be open, and the Jobs view is usually not
  // the one. Toast for the interruption, alert store for the record.
  useEffect(() => {
    const bridge = window.reigan?.jobs
    if (!bridge) return
    return bridge.onNotification((event) => {
      useJobAlertStore.getState().push(event)
      useToastStore.getState().push(`${event.title} — ${event.body}`, alertVariant(event.kind))
    })
  }, [])

  const renderModule = () => {
    switch (activeModule) {
      case 'chat':
        return <ChatPanel />
      case 'tasks':
        return <TaskPanel />
      case 'calendar':
        return <CalendarPanel />
      case 'mail':
        return <MailPanel />
      case 'files':
        return <FilesPanel />
      case 'performance':
        return <PerformancePanel />
      case 'automations':
        return <AutomationsPanel />
      case 'dev':
        return (
          <Suspense fallback={<div className="h-full" />}>
            <DevToolsPanel />
          </Suspense>
        )
      default:
        return <PlaceholderModule module={activeModule} />
    }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden grained" style={{ backgroundColor: 'var(--bg-void)' }}>
      <TitleBar />
      {/* The three regions sit as framed panels on a void mount rather than as
          slabs butted edge to edge. The gutter is what lets an ornate border
          read as a border at all: a moulding run into the corner of the window
          has nowhere to turn, and its outer corners would be clipped away. It
          also replaces the hairline seams the rail and the orb column used to
          draw — a gap divides them more definitely than a 1px line did.
          `overflow-hidden` on <main> matters: it clips each module's own
          background to the frame's radius, so the chat surface's damask stops
          at the moulding instead of squaring off behind it. */}
      <div className="flex flex-1 overflow-hidden gap-2.5 p-2.5">
        <NavBar />
        <main className="ornate flex-1 overflow-hidden" style={{ backgroundColor: 'transparent' }}>
          {renderModule()}
        </main>
        {showOrbColumn && <OrbColumn />}
      </div>
      <ToastStack />
      {/* Global: a write-tier action can be requested from any tab, or by a
          scheduled job while another tab is open. */}
      <ApprovalDialog />
    </div>
  )
}
