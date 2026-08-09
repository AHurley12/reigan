import React from 'react'
import {
  MessageSquare, CheckSquare, Folder, Mail,
  Calendar, Zap, Code, Settings, Gauge
} from 'lucide-react'
import { NavItem } from './NavItem'
import { useAppStore } from '../../stores/appStore'
import { NAV_ITEMS } from '../../../../shared/constants'
import type { AppModule } from '../../../../shared/types'

const ICON_MAP: Record<string, React.ReactNode> = {
  MessageSquare: <MessageSquare size={18} />,
  CheckSquare: <CheckSquare size={18} />,
  Folder: <Folder size={18} />,
  Mail: <Mail size={18} />,
  Calendar: <Calendar size={18} />,
  Gauge: <Gauge size={18} />,
  Zap: <Zap size={18} />,
  Code: <Code size={18} />,
}

export function NavBar() {
  const { activeModule, setActiveModule, settingsOpen, setSettingsOpen } = useAppStore()

  return (
    <div
      // py-4 rather than py-2: the frame's corner ornament runs 14px inward,
      // and at the old padding the first and last buttons sat inside it —
      // an active item's tinted background then collided with the moulding.
      className="ornate flex flex-col items-center py-4 px-2 shrink-0"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--bg-surface)',
      }}
    >
      {/* Nav items */}
      <div className="flex flex-col gap-1 w-full flex-1">
        {NAV_ITEMS.map((item, i) => (
          <NavItem
            key={item.id}
            id={item.id as AppModule}
            icon={ICON_MAP[item.icon]}
            en={item.en}
            ja={item.ja}
            romaji={item.romaji}
            isActive={activeModule === item.id}
            onClick={() => setActiveModule(item.id as AppModule)}
            shortcut={`Ctrl+${i + 1}`}
          />
        ))}
      </div>

      {/* Settings button */}
      <button
        onClick={() => setSettingsOpen(true)}
        className="w-full flex items-center justify-center h-10 rounded-sm transition-all duration-fast"
        style={{
          color: settingsOpen ? 'var(--text-primary)' : 'var(--text-muted)',
          background: settingsOpen ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)' : 'transparent',
          border: settingsOpen ? '1px solid var(--reigan-primary)' : '1px solid transparent',
        }}
        aria-label="Settings"
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
