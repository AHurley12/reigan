import { create } from 'zustand'
import type { ChatMessage, ChatStreamFrame } from '../../../shared/types'
import { useAppStore } from './appStore'
import { reduceStreamFrame, type StreamState } from './streamReducer'

interface ChatStore extends StreamState {
  conversationId: string | null
  addUserMessage: (content: string) => ChatMessage
  startStreaming: (requestId: string) => string
  setConversationId: (id: string) => void
  clearMessages: () => void
  /** Starts a fresh conversation. The row is created by main on the next send. */
  newConversation: () => void
  /** Replaces the transcript with a stored conversation, read back from SQLite. */
  loadConversation: (id: string) => Promise<void>
  /** Sends a message as if typed — shared by the chat input and voice transcripts. */
  sendMessage: (text: string) => Promise<void>
  /** Stops the in-flight generation. The partial reply is kept. */
  abort: () => Promise<void>
  /** Routes a raw IPC stream frame to the in-flight assistant message. */
  handleStreamFrame: (frame: ChatStreamFrame) => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isStreaming: false,
  conversationId: null,
  streamingId: null,
  requestId: null,

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

  startStreaming: (requestId) => {
    const id = crypto.randomUUID()
    const msg: ChatMessage = {
      id,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
    }
    set((s) => ({ messages: [...s.messages, msg], isStreaming: true, streamingId: id, requestId }))
    return id
  },

  setConversationId: (id) => set({ conversationId: id }),

  clearMessages: () =>
    set({ messages: [], conversationId: null, streamingId: null, requestId: null, isStreaming: false }),

  newConversation: () => {
    // Main creates the row on the next send, titled from that message. Creating
    // one here would litter the sidebar with empty conversations every time
    // someone clicked New chat and then changed their mind.
    void get().abort()
    get().clearMessages()
  },

  loadConversation: async (id) => {
    // Switching away from a live generation would leave it writing into a
    // transcript that is no longer on screen.
    if (get().isStreaming) await get().abort()

    const outcome = await window.reigan?.capabilities?.invoke<{
      conversation: { id: string; title: string }
      messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: number }>
    }>('chat.getConversation', { id })

    // A failed load leaves the current transcript alone rather than blanking
    // it — losing what is on screen is worse than not switching.
    if (!outcome?.ok || !outcome.result) return

    set({
      messages: outcome.result.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      })),
      conversationId: id,
      isStreaming: false,
      streamingId: null,
      requestId: null,
    })
  },

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
    // Generated here rather than in main so the store can start dropping frames
    // from a previous request the instant this one begins.
    const requestId = crypto.randomUUID()
    get().startStreaming(requestId)
    useAppStore.getState().setReiganState('processing')

    try {
      await ipc.sendMessage({ message: text, history, conversationId: get().conversationId ?? undefined, requestId })
    } catch (err) {
      // The bridge itself failed, so no `done` frame is coming. Terminate the
      // message here or its cursor blinks forever.
      get().handleStreamFrame({
        requestId,
        conversationId: get().conversationId ?? '',
        event: { kind: 'done', reason: 'error', message: err instanceof Error ? err.message : String(err) },
      })
    }
  },

  abort: async () => {
    const requestId = get().requestId
    if (!requestId) return
    await window.reigan?.abortMessage?.(requestId)
    // No optimistic finalize here: main answers the abort with a `done` frame
    // carrying reason 'aborted', and that is what closes the message out. Doing
    // it twice would race the partial-save.
  },

  handleStreamFrame: (frame) => {
    const before = get()
    const after = reduceStreamFrame(before, frame)
    if (after === before) return
    set(after)

    if (frame.event.kind === 'done') {
      if (frame.conversationId) get().setConversationId(frame.conversationId)
      const app = useAppStore.getState()
      if (frame.event.reason === 'error') {
        app.setReiganState('error')
      } else if (app.reiganState === 'processing') {
        // Only when still processing: a voice reply has already moved to
        // 'speaking' by now and must not be knocked back to idle.
        app.setReiganState('idle')
      }
    }
  },
}))
