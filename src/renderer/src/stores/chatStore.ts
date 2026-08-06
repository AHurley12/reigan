import { create } from 'zustand'
import type { ChatMessage } from '../../../shared/types'
import { useAppStore } from './appStore'

interface ChatStore {
  messages: ChatMessage[]
  isStreaming: boolean
  conversationId: string | null
  streamingId: string | null
  addUserMessage: (content: string) => ChatMessage
  startStreaming: () => string
  appendToken: (id: string, token: string) => void
  finalizeMessage: (id: string) => void
  setConversationId: (id: string) => void
  clearMessages: () => void
  /** Sends a message as if typed — shared by the chat input and voice transcripts. */
  sendMessage: (text: string) => Promise<void>
  /** Routes a raw IPC stream event to the in-flight assistant message. */
  handleStreamEvent: (data: { token: string; done: boolean; conversationId: string }) => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isStreaming: false,
  conversationId: null,
  streamingId: null,

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
    set((s) => ({ messages: [...s.messages, msg], isStreaming: true, streamingId: id }))
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
      streamingId: s.streamingId === id ? null : s.streamingId,
    }))
  },

  setConversationId: (id) => set({ conversationId: id }),
  clearMessages: () => set({ messages: [], conversationId: null }),

  sendMessage: async (text) => {
    const ipc = window.reigan
    if (!ipc) return
    // Voice can fire multiple "final" transcript segments in quick succession
    // (e.g. holding push-to-talk). Without this guard, a second send while one
    // is still streaming overwrites streamingId and orphans the first message
    // mid-stream — it never gets its `done` event, so its cursor never clears.
    if (get().isStreaming) return

    const history = get().messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    get().addUserMessage(text)
    const msgId = get().startStreaming()
    useAppStore.getState().setReiganState('processing')

    try {
      await ipc.sendMessage({ message: text, history, conversationId: get().conversationId ?? undefined })
    } catch (err) {
      get().appendToken(msgId, `\n\n*Error: ${err}*`)
      get().finalizeMessage(msgId)
      useAppStore.getState().setReiganState('error')
    }
  },

  handleStreamEvent: (data) => {
    const id = get().streamingId
    if (!id) return

    if (data.done) {
      get().finalizeMessage(id)
      if (useAppStore.getState().reiganState === 'processing') {
        useAppStore.getState().setReiganState('idle')
      }
      if (data.conversationId) get().setConversationId(data.conversationId)
    } else {
      get().appendToken(id, data.token)
    }
  },
}))
