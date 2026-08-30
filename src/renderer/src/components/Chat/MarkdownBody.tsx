import React, { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Copy } from 'lucide-react'
import { useCopy } from './useCopy'

/**
 * The rendered-markdown body of a reply.
 *
 * Split out of StreamingText so the markdown configuration — plugins, prose
 * styling, and the component overrides below — lives in exactly one place. It
 * is rendered from two call sites once streaming is progressive, and the two
 * must not drift.
 */
export function MarkdownBody({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock, table: Table }}>
      {children}
    </ReactMarkdown>
  )
}

/**
 * A table in its own horizontal scroller.
 *
 * A wide table must scroll inside its own container rather than widening the
 * transcript — the chat column is already constrained, and a table with eight
 * columns of data would otherwise push the composer and the sidebar off screen.
 */
function Table({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto my-2">
      <table {...props}>{children}</table>
    </div>
  )
}

/**
 * A fenced code block with its own copy control.
 *
 * The text is read from the DOM node's `textContent` rather than reassembled
 * from React children. Children here are the syntax-neutral element tree
 * react-markdown produced, and walking it to recover the source means handling
 * every nested node type; `textContent` is exactly the code as rendered, which
 * is what the user is asking for when they press Copy.
 */
function CodeBlock({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null)
  const { copied, copy } = useCopy()

  return (
    <div className="relative group/code">
      <pre ref={ref} {...props}>
        {children}
      </pre>
      <button
        onClick={() => void copy(ref.current?.textContent ?? '')}
        aria-label={copied ? 'Copied' : 'Copy code'}
        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-sm flex items-center justify-center
          opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100 focus:opacity-100
          transition-opacity"
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
        }}
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </div>
  )
}
