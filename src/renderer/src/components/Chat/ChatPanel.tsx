import React, { useEffect, useRef } from 'react'
import { Message } from './Message'
import { InputBar } from './InputBar'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'

const NEAR_BOTTOM_THRESHOLD = 100
const SCROLL_THROTTLE_MS = 100

export function ChatPanel() {
  const messages = useChatStore((s) => s.messages)
  const sendMessage = useChatStore((s) => s.sendMessage)
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
    <div className="flex flex-col h-full">
      {/* Message list */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-6 py-6"
        style={{ background: 'var(--bg-void)' }}
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

      {/* Input bar */}
      <InputBar onSend={sendMessage} inputRef={chatInputRef} />
    </div>
  )
}
