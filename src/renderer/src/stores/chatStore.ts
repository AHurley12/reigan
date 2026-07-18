import { create } from 'zustand'
import type { ChatMessage } from '../../../shared/types'
import { randomUUID } from 'crypto'

interface ChatStore {
  messages: ChatMessage[]
  isStreaming: boolean
  conversationId: string | null
  addUserMessage: (content: string) => ChatMessage
  startStreaming: () => string
  appendToken: (id: string, token: string) => void
  finalizeMessage: (id: string) => void
  setConversationId: (id: string) => void
  clearMessages: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isStreaming: false,
  conversationId: null,

  addUserMessage: (content) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, msg] }))
    return msg
  },

  startStreaming: () => {
    const id = crypto.randomUUID()
    const msg: ChatMessage = {
      id,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }
    set((s) => ({ messages: [...s.messages, msg], isStreaming: true }))
    return id
  },

  appendToken: (id, token) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + token } : m
      ),
    }))
  },

  finalizeMessage: (id) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, isStreaming: false } : m
      ),
      isStreaming: false,
    }))
  },

  setConversationId: (id) => set({ conversationId: id }),
  clearMessages: () => set({ messages: [], conversationId: null }),
}))
