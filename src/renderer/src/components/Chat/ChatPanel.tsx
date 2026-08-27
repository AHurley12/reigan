import React, { useEffect, useRef } from 'react'
import { Message } from './Message'
import { InputBar } from './InputBar'
import { ConversationList } from './ConversationList'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'

const NEAR_BOTTOM_THRESHOLD = 100
const SCROLL_THROTTLE_MS = 100

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const lastScrollAtRef = useRef(0)

  // Auto-scroll — only if the user hasn't scrolled up to read history, and
  // throttled so rapid token updates during streaming don't fight the user.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > NEAR_BOTTOM_THRESHOLD) return

    const now = Date.now()
    if (now - lastScrollAtRef.current < SCROLL_THROTTLE_MS) return
    lastScrollAtRef.current = now

    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const isEmpty = messages.length === 0

  return (
    <div className="flex h-full">
      <ConversationList />

      {/* min-w-0 so a long unbroken code line in the transcript cannot push the
          sidebar off the panel — a flex child's default min-width is its
          content, not zero. */}
      <div className="flex flex-col flex-1 min-w-0">
      {/* Message list */}
      {/* The transcript had no landmark at all, so assistive tech saw an
          undifferentiated stack of divs. `role="log"` makes it navigable.
          The live announcement is deliberately NOT on this container: tokens
          arrive dozens of times a second, and an aria-live region here would
          re-announce the growing reply continuously. The status line below
          carries the announcement instead. */}
      <div
        ref={scrollRef}
        role="log"
        aria-label="Conversation"
        className="chat-surface flex-1 overflow-y-auto px-6 py-6"
        style={{ backgroundColor: 'transparent' }}
      >
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            {japaneseLevel >= 1 && (
              <div
                className="text-5xl font-kanji"
                style={{ color: 'var(--text-kanji)', opacity: 0.3 }}
              >
                心眼
              </div>
            )}
            <div className="space-y-1">
              <p className="font-display text-lg" style={{ color: 'var(--text-secondary)' }}>
                Welcome. I am Shingan.
              </p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                To activate, add your Anthropic API key in{' '}
                <span className="font-mono" style={{ color: 'var(--text-accent)' }}>
                  Settings (Ctrl+,)
                </span>
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto">
            {messages.map((msg) => (
              <Message key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* One short, polite announcement per state change, rather than a live
          region over the streaming text itself. */}
      <div className="sr-only" role="status" aria-live="polite">
        {isStreaming ? 'Shingan is replying.' : ''}
      </div>

      {/* Input bar */}
      <InputBar
        onSend={(text, attachments) => void sendMessage(text, { attachments })}
        inputRef={chatInputRef}
      />
      </div>
    </div>
  )
}
