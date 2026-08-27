import React, { useState, KeyboardEvent } from 'react'
import { StreamingText } from './StreamingText'
import { MessageActions } from './MessageActions'
import { useChatStore } from '../../stores/chatStore'
import type { ChatMessage } from '../../../../shared/types'

interface Props {
  message: ChatMessage
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function Message({ message }: Props) {
  const isUser = message.role === 'user'
  const resendFrom = useChatStore((s) => s.resendFrom)
  const [editing, setEditing] = useState(false)

  if (isUser) {
    if (editing) {
      return (
        <MessageEditor
          initial={message.content}
          onCancel={() => setEditing(false)}
          onSubmit={(text) => {
            setEditing(false)
            void resendFrom(message.id, text)
          }}
        />
      )
    }

    return (
      <div className="group flex justify-end mb-4">
        <div className="max-w-[75%] animate-slide-up">
          <div
            className="px-4 py-3 rounded-lg text-sm leading-relaxed"
            style={{
              background: 'var(--bg-subtle)',
              color: 'var(--text-primary)',
              borderRadius: '12px 12px 4px 12px',
            }}
          >
            {message.content}
          </div>
          <div className="text-right mt-1">
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {formatTime(message.timestamp)}
            </span>
          </div>
          <MessageActions content={message.content} align="right" onEdit={() => setEditing(true)} />
        </div>
      </div>
    )
  }

  return (
    <div className="group flex flex-col mb-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs font-kanji tracking-wider"
          style={{ color: 'var(--text-kanji)' }}
        >
          心眼
        </span>
        <span
          className="text-xs font-display font-medium"
          style={{ color: 'var(--text-muted)' }}
        >
          SHINGAN
        </span>
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {formatTime(message.timestamp)}
        </span>
        {message.stoppedByUser && (
          // Labelled, not just tinted: "stopped" and "finished" must not be
          // distinguishable by hue alone.
          <span
            className="text-[10px] px-1.5 py-0.5 rounded-full"
            style={{
              background: 'color-mix(in srgb, var(--text-muted) 14%, transparent)',
              color: 'var(--text-muted)',
            }}
          >
            Stopped
          </span>
        )}
      </div>
      <div className="pl-1">
        <StreamingText content={message.content} isStreaming={message.isStreaming} />
      </div>
      {/* Actions only once the reply has settled: copying or regenerating a
          half-arrived answer produces something the user did not mean. */}
      {!message.isStreaming && (
        <MessageActions content={message.content} onRegenerate={() => void resendFrom(message.id)} />
      )}
    </div>
  )
}

/**
 * Inline editor for a user turn.
 *
 * Controlled, unlike the main composer: the unsaved-changes guard has to
 * compare the draft against the original, which an uncontrolled textarea
 * cannot do without reading the DOM on every close.
 */
function MessageEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string
  onSubmit: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const dirty = draft.trim() !== initial.trim()

  const cancel = () => {
    // Warn before discarding, the same rule that governs navigating away from
    // an unsaved form. An untouched draft closes silently.
    if (dirty && !window.confirm('Discard your changes to this message?')) return
    onCancel()
  }

  const submit = () => {
    if (!draft.trim()) return
    onSubmit(draft)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      // Stops the window-level handler from also reading this Escape as
      // "stop generating".
      e.stopPropagation()
      cancel()
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex justify-end mb-4">
      <div className="w-[75%]">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={Math.min(10, draft.split('\n').length + 1)}
          autoFocus
          aria-label="Edit your message"
          className="ornate ornate-focus w-full resize-none bg-elevated px-3 py-2 text-sm
            text-txt-primary focus:outline-none"
          style={{ fontFamily: 'var(--font-body)' }}
        />
        <div className="flex items-center justify-end gap-2 mt-1.5">
          <span className="text-[11px] mr-auto" style={{ color: 'var(--text-muted)' }}>
            Resending replaces every reply after this message.
          </span>
          <button
            onClick={cancel}
            className="px-2.5 py-1 rounded-sm text-xs transition-colors"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="px-2.5 py-1 rounded-sm text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--reigan-gradient)', color: 'var(--text-on-accent)' }}
          >
            Resend
          </button>
        </div>
      </div>
    </div>
  )
}
