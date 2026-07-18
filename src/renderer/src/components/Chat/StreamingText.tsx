import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  isStreaming?: boolean
}

export function StreamingText({ content, isStreaming }: Props) {
  return (
    <div className="prose prose-invert prose-sm max-w-none
      [&_p]:text-txt-secondary [&_p]:leading-relaxed
      [&_code]:font-mono [&_code]:text-txt-accent [&_code]:bg-subtle [&_code]:px-1 [&_code]:rounded
      [&_pre]:bg-subtle [&_pre]:rounded-md [&_pre]:p-3
      [&_a]:text-reigan-secondary [&_a]:no-underline [&_a:hover]:underline
      [&_strong]:text-txt-primary
      [&_ul]:text-txt-secondary [&_ol]:text-txt-secondary
      [&_li]:marker:text-txt-muted
      [&_blockquote]:border-l-2 [&_blockquote]:border-reigan-primary/50 [&_blockquote]:pl-3 [&_blockquote]:text-txt-muted
      [&_h1]:font-display [&_h1]:text-txt-primary
      [&_h2]:font-display [&_h2]:text-txt-primary
      [&_h3]:font-display [&_h3]:text-txt-primary
    ">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
      {isStreaming && (
        <span
          className="inline-block w-0.5 h-4 ml-0.5 align-middle animate-cursor"
          style={{ background: 'var(--reigan-secondary)' }}
        />
      )}
    </div>
  )
}
