import { ThemeSelect } from '../ThemeSelect'

export function AppearanceSettings() {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Theme</p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Changes apply instantly across the whole app.</p>
        <ThemeSelect />
      </div>
    </div>
  )
}
