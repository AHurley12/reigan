import React from 'react'
import {
  MessageSquare, CheckSquare, Folder, Mail,
  Calendar, Zap, Code, Settings
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
  Zap: <Zap size={18} />,
  Code: <Code size={18} />,
}

export function NavBar() {
  const { activeModule, setActiveModule, settingsOpen, setSettingsOpen } = useAppStore()

  return (
    <div
      className="flex flex-col items-center py-2 shrink-0"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        height: '100%',
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
        className="w-full flex items-center justify-center h-10 rounded-[3px] mx-1 transition-all duration-fast"
        style={{
          color: settingsOpen ? 'var(--text-primary)' : 'var(--text-muted)',
          background: settingsOpen ? 'rgba(216, 67, 42, 0.18)' : 'transparent',
          border: settingsOpen ? '1px solid var(--reigan-primary)' : '1px solid transparent',
        }}
        aria-label="Settings"
      >
        <Settings size={18} />
      </button>
    </div>
  )
}
