import React from 'react'

type Variant = 'primary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: React.ReactNode
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-reigan-primary text-white hover:opacity-90',
  ghost: 'bg-transparent border border-[var(--border)] text-txt-secondary hover:border-[var(--border-hover)] hover:text-txt-primary',
  danger: 'bg-critical/10 border border-critical/30 text-critical hover:bg-critical/20',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs rounded-md',
  md: 'px-4 py-2 text-sm rounded-md',
  lg: 'px-6 py-3 text-base rounded-lg',
}

export function Button({ variant = 'ghost', size = 'md', className = '', children, ...props }: Props) {
  return (
    <button
      className={`
        inline-flex items-center justify-center gap-2 font-medium
        transition-all duration-fast ease-standard
        disabled:opacity-40 disabled:cursor-not-allowed
        titlebar-no-drag
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${className}
      `}
      {...props}
    >
      {children}
    </button>
  )
}
