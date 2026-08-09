import { useEffect, useState } from 'react'
import { Eye, EyeOff, Check } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { AppSettings } from '../../../../../shared/types'

interface Props {
  settingKey: keyof AppSettings
  placeholder: string
  /** Set false for values that aren't actually secret (e.g. a Client ID) but
   *  still want the same deliberate-save field + button treatment. */
  masked?: boolean
}

/**
 * A credential field with its own explicit Save — deliberate, not
 * auto-persisted, so a half-typed or half-pasted key never lands in SQLite.
 *
 * For secret keys the renderer is never given the stored value (see
 * `getSettingsForRenderer`), so there is nothing to pre-fill: the input starts
 * empty and the saved key is represented by a `•••• 4f2a` preview beside it.
 * Typing replaces the key; leaving it blank changes nothing. That also means
 * the old reveal button is meaningless for a saved key — there is nothing in
 * the renderer to reveal — so it only appears while you are typing one.
 */
export function ApiKeyField({ settingKey, placeholder, masked = true }: Props) {
  const storedValue = useSettingsStore((s) => s.settings[settingKey] as string)
  const preview = useSettingsStore((s) => s.secretPreviews[settingKey as string])
  const refreshPreviews = useSettingsStore((s) => s.refreshSecretPreviews)
  const set = useSettingsStore((s) => s.set)
  const [value, setValue] = useState(storedValue ?? '')
  const [visible, setVisible] = useState(!masked)
  const [saved, setSaved] = useState(false)

  useEffect(() => setValue(storedValue ?? ''), [storedValue])

  const handleSave = () => {
    if (masked && value.trim() === '') return
    set(settingKey, value as AppSettings[typeof settingKey])
    setSaved(true)
    if (masked) {
      // Clear the typed key out of renderer memory the moment it is committed,
      // and re-read the preview so the field reflects the new last-4.
      setValue('')
      setVisible(false)
      void refreshPreviews()
    }
    setTimeout(() => setSaved(false), 1600)
  }

  const hasSavedSecret = masked && !!preview?.hasValue
  const effectivePlaceholder = hasSavedSecret
    ? `•••• ${preview.last4 || '••••'} — saved. Type to replace.`
    : placeholder

  const displayValue = !visible && value.length > 4
    ? `${'•'.repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`
    : value

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <input
          type="text"
          value={visible ? value : displayValue}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setVisible(true)}
          placeholder={effectivePlaceholder}
          className={`w-full bg-elevated rounded-md px-3 py-2 text-sm ${masked ? 'pr-9' : ''}
            placeholder:text-txt-muted text-txt-primary
            border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
            font-mono transition-colors`}
        />
        {masked && value.length > 0 && (
          <button
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
            aria-label={visible ? 'Hide' : 'Show'}
            type="button"
          >
            {visible ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        )}
      </div>
      <button
        onClick={handleSave}
        className="px-3 rounded-md text-xs border transition-colors shrink-0"
        style={{
          background: saved ? 'var(--reigan-primary)' : 'var(--bg-elevated)',
          borderColor: saved ? 'var(--reigan-primary)' : 'var(--border)',
          color: saved ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
      >
        {saved ? <Check size={14} /> : 'Save'}
      </button>
    </div>
  )
}
