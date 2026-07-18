import React from 'react'

interface Props {
  en: string
  ja: string
  className?: string
}

export function SectionHeader({ en, ja, className = '' }: Props) {
  return (
    <div className={`flex flex-col gap-0.5 ${className}`}>
      <span className="font-display text-txt-primary font-medium tracking-wide">{en}</span>
      <span className="font-body text-txt-kanji text-xs">{ja}</span>
    </div>
  )
}
