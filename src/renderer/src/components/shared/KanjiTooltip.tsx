import React, { useState } from 'react'

interface Props {
  kanji: string
  romaji: string
  meaning: string
  children: React.ReactNode
}

export function KanjiTooltip({ kanji, romaji, meaning, children }: Props) {
  const [show, setShow] = useState(false)

  return (
    <span
      className="relative inline-block cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
          bg-elevated border border-[var(--border)] rounded-md px-3 py-2
          text-xs whitespace-nowrap shadow-lg animate-slide-up">
          <div className="font-kanji text-txt-accent text-base">{kanji}</div>
          <div className="text-txt-muted">{romaji}</div>
          <div className="text-txt-secondary">{meaning}</div>
        </div>
      )}
    </span>
  )
}
