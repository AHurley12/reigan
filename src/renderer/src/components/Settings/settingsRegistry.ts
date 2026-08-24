import type { ComponentType } from 'react'
import { Sliders, Languages, Mic, Plug, Flame, Palette, ShieldCheck, Brain, type LucideIcon } from 'lucide-react'
import { GeneralSettings } from './tabs/GeneralSettings'
import { JapaneseSettings } from './tabs/JapaneseSettings'
import { VoiceSettings } from './tabs/VoiceSettings'
import { ConnectionsSettings } from './tabs/ConnectionsSettings'
import { PersonalitySettings } from './tabs/PersonalitySettings'
import { ContextSettings } from './tabs/ContextSettings'
import { AppearanceSettings } from './tabs/AppearanceSettings'
import { SecuritySettings } from './tabs/SecuritySettings'

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
  { id: 'appearance', labelEn: 'Appearance', labelJa: '外観', icon: Palette, component: AppearanceSettings },
  { id: 'personality', labelEn: 'Personality', labelJa: '性格', icon: Flame, component: PersonalitySettings },
  { id: 'context', labelEn: 'Context', labelJa: '記憶', icon: Brain, component: ContextSettings },
  { id: 'japanese', labelEn: 'Japanese', labelJa: '日本語', icon: Languages, component: JapaneseSettings },
  { id: 'voice', labelEn: 'Voice', labelJa: '音声', icon: Mic, component: VoiceSettings },
  { id: 'security', labelEn: 'Security', labelJa: '施錠', icon: ShieldCheck, component: SecuritySettings },
  { id: 'connections', labelEn: 'Connections', labelJa: '接続', icon: Plug, component: ConnectionsSettings },
]
