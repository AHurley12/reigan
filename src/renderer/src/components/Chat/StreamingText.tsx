import React, { useEffect, useState } from 'react'
import { InscribeText } from './InscribeText'
import { MarkdownBody } from './MarkdownBody'
import { splitStreamedMarkdown } from './markdownSplit'

interface Props {
  content: string
  isStreaming?: boolean
}

export function StreamingText({ content, isStreaming }: Props) {
  // Recomputed per token, which is a linear scan of a reply — cheap next to the
  // markdown re-render it feeds, and memoising it would need the same scan to
  // decide whether the memo is stale.
  const { settled, tail } = isStreaming
    ? splitStreamedMarkdown(content)
    : { settled: '', tail: '' }

  // Keep the cursor mounted briefly after streaming ends so it can fade out
  // instead of vanishing the instant the final token arrives.
  const [showCursor, setShowCursor] = useState(!!isStreaming)

  useEffect(() => {
    if (isStreaming) {
      setShowCursor(true)
      return
    }
    if (!showCursor) return
    const timeout = setTimeout(() => setShowCursor(false), 300)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming])

  return (
    // Every element markdown can emit is styled from tokens here, because
    // nothing else styles them. The `prose prose-invert prose-sm` classes that
    // used to head this list generated no CSS at all — @tailwindcss/typography
    // is not a dependency and tailwind.config.ts declares `plugins: []` — so
    // anything absent from this list fell through to browser defaults. That was
    // invisible for paragraphs, which inherit a themed colour from `body`, and
    // very visible for GFM tables, which arrived with no borders or padding.
    //
    // `prose-invert` was also a dark-theme assumption inside a four-theme app:
    // aero's text.primary is #06303F, dark ink on a light ground.
    <div className="max-w-none
      [&_p]:text-txt-secondary [&_p]:leading-relaxed
      [&_code]:font-mono [&_code]:text-txt-accent [&_code]:bg-subtle [&_code]:px-1 [&_code]:rounded
      [&_pre]:bg-subtle [&_pre]:rounded-md [&_pre]:p-3 [&_pre]:overflow-x-auto
      [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-txt-secondary
      [&_a]:text-reigan-secondary [&_a]:no-underline [&_a:hover]:underline
      [&_strong]:text-txt-primary [&_em]:text-txt-secondary [&_del]:text-txt-muted
      [&_ul]:text-txt-secondary [&_ol]:text-txt-secondary
      [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5
      [&_li]:marker:text-txt-muted
      [&_blockquote]:border-l-2 [&_blockquote]:border-reigan-primary/50 [&_blockquote]:pl-3 [&_blockquote]:text-txt-muted
      [&_h1]:font-display [&_h1]:text-txt-primary
      [&_h2]:font-display [&_h2]:text-txt-primary
      [&_h3]:font-display [&_h3]:text-txt-primary
      [&_h4]:font-display [&_h4]:text-txt-primary
      [&_h5]:font-display [&_h5]:text-txt-primary
      [&_h6]:font-display [&_h6]:text-txt-primary
      [&_hr]:border-[var(--border)]
      [&_table]:w-full [&_table]:border-collapse [&_table]:text-txt-secondary
      [&_th]:font-display [&_th]:text-txt-primary [&_th]:text-left
      [&_th]:px-2 [&_th]:py-1 [&_th]:border [&_th]:border-[var(--border)]
      [&_td]:px-2 [&_td]:py-1 [&_td]:border [&_td]:border-[var(--border)]
      [&_img]:max-w-full [&_img]:rounded-md
    ">
      {/* Progressive, rather than plain text that snaps to markdown at the end.
          Blocks that are finished render as markdown immediately; only the
          fragment still being written keeps the inscribe effect, so the live
          edge still reads as Reigan writing while everything behind it is
          already formatted. splitStreamedMarkdown guarantees settled + tail is
          exactly the content, so nothing is dropped or shown twice. */}
      {isStreaming ? (
        <>
          {settled && <MarkdownBody>{settled}</MarkdownBody>}
          {tail && (
            <p className="inscribe-body" style={{ color: 'var(--text-secondary)' }}>
              <InscribeText text={tail} />
            </p>
          )}
        </>
      ) : (
        <MarkdownBody>{content}</MarkdownBody>
      )}
      {showCursor && (
        <span
          className={`response-cursor inline-block w-0.5 h-4 ml-0.5 align-middle ${
            isStreaming ? 'animate-cursor' : 'animate-cursor-out'
          }`}
          style={{ background: 'var(--accent-primary)' }}
        />
      )}
    </div>
  )
}
