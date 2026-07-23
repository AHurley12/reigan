interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
}

export function Toggle({ checked, onChange, label }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center rounded-full transition-colors duration-fast"
      style={{
        width: 36,
        height: 20,
        background: checked ? 'var(--reigan-primary)' : 'var(--bg-subtle)',
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
