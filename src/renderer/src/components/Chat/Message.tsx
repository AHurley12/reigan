import React from 'react'
import { StreamingText } from './StreamingText'
import type { ChatMessage } from '../../../../shared/types'

interface Props {
  message: ChatMessage
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function Message({ message }: Props) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
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
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {formatTime(message.timestamp)}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col mb-6 animate-fade-in">
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
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div className="pl-1">
        <StreamingText content={message.content} isStreaming={message.isStreaming} />
      </div>
    </div>
  )
}
