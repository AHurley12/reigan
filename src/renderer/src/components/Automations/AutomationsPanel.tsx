import React, { Suspense, useState } from 'react'
import { SectionHeader } from '../shared/SectionHeader'
import { JobsView } from './JobsView'
import { YouTubeView } from './YouTubeView'

/**
 * The Automations tab.
 *
 * Sections are lazily mounted — several of them (the asset grid, usage sessions)
 * are heavy, and the tab must not pay for them until they are opened. Jobs is
 * the landing section because it is the health dashboard for everything else.
 */

interface Section {
  id: string
  en: string
  ja: string
  romaji: string
  /** Sections still to be built land on the placeholder rather than a broken view. */
  component?: React.ComponentType
}

const SECTIONS: Section[] = [
  { id: 'jobs',    en: 'Jobs',      ja: '仕事',     romaji: 'shigoto', component: JobsView },
  { id: 'youtube', en: 'YouTube',   ja: '動画',     romaji: 'douga',   component: YouTubeView },
  { id: 'content', en: 'Content',   ja: '制作',     romaji: 'seisaku' },
  { id: 'assets',  en: 'Assets',    ja: '素材',     romaji: 'sozai' },
  { id: 'mail',    en: 'Mail Rules',ja: '規則',     romaji: 'kisoku' },
  { id: 'digest',  en: 'Digest',    ja: '要約',     romaji: 'youyaku' },
  { id: 'usage',   en: 'Usage',     ja: '使用',     romaji: 'shiyou' },
  { id: 'social',  en: 'Social',    ja: '社交',     romaji: 'shakou' },
]

function ComingSoon({ section }: { section: Section }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
      <div className="text-6xl font-kanji" style={{ color: 'var(--text-kanji)', opacity: 0.12 }}>
        {section.ja}
      </div>
      <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
        {section.en} — not built yet
      </span>
    </div>
  )
}

export function AutomationsPanel() {
  const [activeId, setActiveId] = useState('jobs')
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0]
  const Active = active.component

  return (
    <div className="flex flex-col h-full">
      <div className="rule-b flex items-center justify-between px-6 py-4 shrink-0">
        <SectionHeader en="Automations" ja="自動化" romaji="jidouka" />
      </div>

      <div className="rule-b px-6 py-2 flex gap-1 shrink-0 overflow-x-auto">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveId(section.id)}
            className={`px-2.5 py-1 rounded text-xs whitespace-nowrap transition-colors ${
              activeId === section.id
                ? 'bg-tint/10 text-txt-primary'
                : 'text-txt-muted hover:text-txt-secondary'
            }`}
            aria-current={activeId === section.id ? 'page' : undefined}
          >
            {section.en}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {Active ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full">
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  Loading…
                </span>
              </div>
            }
          >
            <Active />
          </Suspense>
        ) : (
          <ComingSoon section={active} />
        )}
      </div>
    </div>
  )
}
