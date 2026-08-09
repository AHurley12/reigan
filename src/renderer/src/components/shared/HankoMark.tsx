interface Props {
  text?: string
  size?: number
  className?: string
}

export function HankoMark({ text = '心眼', size = 28, className = '' }: Props) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-[3px] select-none ${className}`}
      style={{
        width: size,
        height: size,
        background: 'var(--reigan-primary)',
        boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--text-primary) 15%, transparent), 0 2px 6px color-mix(in srgb, var(--accent-primary) 35%, transparent)',
      }}
      aria-hidden="true"
    >
      <span
        style={{
          fontFamily: 'var(--font-seal)',
          fontSize: text.length > 1 ? size * 0.36 : size * 0.5,
          lineHeight: 1,
          color: 'var(--text-primary)',
          writingMode: text.length > 1 ? 'vertical-rl' : undefined,
          letterSpacing: text.length > 1 ? '1px' : undefined,
        }}
      >
        {text}
      </span>
    </span>
  )
}
