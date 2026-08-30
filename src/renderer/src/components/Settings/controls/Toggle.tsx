interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  /**
   * For a setting that exists but cannot apply right now — an option the
   * current model does not support, say. The row stays visible with its
   * explanation rather than vanishing, so the setting does not appear to come
   * and go on its own.
   */
  disabled?: boolean
}

export function Toggle({ checked, onChange, label, disabled = false }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors duration-fast
        disabled:cursor-not-allowed"
      style={{
        width: 36,
        height: 20,
        background: checked ? 'var(--reigan-primary)' : 'var(--bg-subtle)',
        opacity: disabled ? 'var(--state-disabled-opacity, 0.4)' : undefined,
      }}
    >
      <span
        className="absolute rounded-full transition-transform duration-fast"
        style={{
          width: 14,
          height: 14,
          left: 3,
          background: checked ? 'var(--text-primary)' : 'var(--text-muted)',
          transform: checked ? 'translateX(16px)' : 'translateX(0)',
        }}
      />
    </button>
  )
}
