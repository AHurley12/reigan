import type { ComponentType } from 'react'
import { Sliders, Languages, Mic, Plug, type LucideIcon } from 'lucide-react'
import { GeneralSettings } from './tabs/GeneralSettings'
import { JapaneseSettings } from './tabs/JapaneseSettings'
import { VoiceSettings } from './tabs/VoiceSettings'
import { ConnectionsSettings } from './tabs/ConnectionsSettings'

export interface SettingsTab {
  id: string
  labelEn: string
  labelJa: string
  icon: LucideIcon
  component: ComponentType
}

// To add a new settings section: build the tab component in ./tabs, then add
// one entry here. That's the whole registration step.
export const SETTINGS_TABS: SettingsTab[] = [
  { id: 'general', labelEn: 'General', labelJa: '一般', icon: Sliders, component: GeneralSettings },
  { id: 'japanese', labelEn: 'Japanese', labelJa: '日本語', icon: Languages, component: JapaneseSettings },
  { id: 'voice', labelEn: 'Voice', labelJa: '音声', icon: Mic, component: VoiceSettings },
  { id: 'connections', labelEn: 'Connections', labelJa: '接続', icon: Plug, component: ConnectionsSettings },
]
