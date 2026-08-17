import React from 'react'
import {
  MessageSquare, CheckSquare, Folder, Mail,
  Calendar, Zap, Code, Settings, Gauge
} from 'lucide-react'
import { NavItem } from './NavItem'
import { RegionParticles } from '../../theme/particles/RegionParticles'
import { useAppStore } from '../../stores/appStore'
import { useJobAlertStore } from '../../stores/jobAlertStore'
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
  // The last mile of job reporting. An alert is captured at the shell whatever
  // tab is open and kept in a standing banner in Automations → Jobs, but until
  // something marked the rail there was nothing to tell a user looking at Chat
  // that the banner was there at all — a 04:00 failure stayed invisible until
  // they happened to open the tab.
  const unseenAlerts = useJobAlertStore((s) => s.unseen)

  return (
    <div
      // py-4 rather than py-2: the frame's corner ornament runs 14px inward,
      // and at the old padding the first and last buttons sat inside it —
      // an active item's tinted background then collided with the moulding.
      className="ornate particle-host particle-host-raised flex flex-col items-center py-4 px-2 shrink-0"
      style={{
        width: 'var(--nav-width)',
        background: 'var(--bg-surface)',
      }}
    >
      {/* Paints on the rail's own surface, under every button below it. */}
      <RegionParticles region="nav" />

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
            badge={item.id === 'automations' ? unseenAlerts : 0}
            badgeLabel="unseen alerts"
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
