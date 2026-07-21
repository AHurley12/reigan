import React, { useEffect, useRef, useCallback } from 'react'
import { Message } from './Message'
import { InputBar } from './InputBar'
import { useChatStore } from '../../stores/chatStore'
import { useAppStore } from '../../stores/appStore'
import { useIPC } from '../../hooks/useIPC'

export function ChatPanel() {
  const { messages, isStreaming, conversationId, addUserMessage, startStreaming, appendToken, finalizeMessage, setConversationId } = useChatStore()
  const { setReiganState } = useAppStore()
  const ipc = useIPC()
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const streamingIdRef = useRef<string | null>(null)

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Register stream listener
  useEffect(() => {
    if (!ipc) return
    const unsub = ipc.onStream((data) => {
      if (!streamingIdRef.current) return
      if (data.token) {
        appendToken(streamingIdRef.current, data.token)
      }
      if (data.done) {
        finalizeMessage(streamingIdRef.current)
        streamingIdRef.current = null
        setReiganState('idle')
        if (data.conversationId) setConversationId(data.conversationId)
      }
    })
    return unsub
  }, [ipc])

  const handleSend = useCallback(async (text: string) => {
    if (!ipc) return

    addUserMessage(text)
    const history = messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const msgId = startStreaming()
    streamingIdRef.current = msgId
    setReiganState('processing')

    try {
      await ipc.sendMessage({ message: text, history, conversationId: conversationId ?? undefined })
    } catch (err) {
      appendToken(msgId, `\n\n*Error: ${err}*`)
      finalizeMessage(msgId)
      streamingIdRef.current = null
      setReiganState('error')
    }
  }, [ipc, messages, conversationId])

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
            <div
              className="text-5xl font-kanji"
              style={{ color: 'var(--text-kanji)', opacity: 0.3 }}
            >
              霊眼
            </div>
            <div className="space-y-1">
              <p className="font-display text-lg" style={{ color: 'var(--text-secondary)' }}>
                Welcome. I am REIGAN.
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
      <InputBar onSend={handleSend} inputRef={chatInputRef} />
    </div>
  )
}
