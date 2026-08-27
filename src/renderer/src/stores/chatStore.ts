import { create } from 'zustand'
import type { ChatAttachmentInput, ChatAttachmentMeta, ChatMessage, ChatStreamFrame, TurnUsage } from '../../../shared/types'
import { useAppStore } from './appStore'
import { reduceStreamFrame, type StreamState } from './streamReducer'
import { planResend } from './resendPlan'

export interface SendOptions {
  /** Regenerate / edit-and-resend: drop this turn and everything after it first. */
  truncateFromTimestamp?: number
  attachments?: ChatAttachmentInput[]
}

interface ChatStore extends StreamState {
  conversationId: string | null
  addUserMessage: (content: string, attachments?: ChatAttachmentInput[]) => ChatMessage
  startStreaming: (requestId: string) => string
  setConversationId: (id: string) => void
  clearMessages: () => void
  /** Starts a fresh conversation. The row is created by main on the next send. */
  newConversation: () => void
  /** Replaces the transcript with a stored conversation, read back from SQLite. */
  loadConversation: (id: string) => Promise<void>
  /** Sends a message as if typed — shared by the chat input and voice transcripts. */
  sendMessage: (text: string, opts?: SendOptions) => Promise<void>
  /**
   * Regenerate, edit-and-resend, and retry — all three are this one operation:
   * drop a user turn and everything after it, then send it again.
   */
  resendFrom: (messageId: string, newContent?: string) => Promise<void>
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

  addUserMessage: (content, attachments) => {
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      // Shown optimistically. Main assigns the real ids when it stores them;
      // these placeholders only have to survive until the conversation is
      // reloaded, and are never sent anywhere.
      attachments: attachments?.map((a, i) => ({
        id: `pending-${i}`,
        messageId: '',
        kind: a.mimeType === 'application/pdf' ? ('document' as const) : ('image' as const),
        mimeType: a.mimeType,
        filename: a.filename,
        byteSize: Math.floor((a.data.length * 3) / 4),
      })),
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
      messages: Array<{
        id: string
        role: 'user' | 'assistant'
        content: string
        timestamp: number
        usage?: TurnUsage
      }>
      attachments: ChatAttachmentMeta[]
    }>('chat.getConversation', { id })

    // A failed load leaves the current transcript alone rather than blanking
    // it — losing what is on screen is worse than not switching.
    if (!outcome?.ok || !outcome.result) return

    const byMessage = new Map<string, ChatAttachmentMeta[]>()
    for (const a of outcome.result.attachments ?? []) {
      const list = byMessage.get(a.messageId) ?? []
      list.push(a)
      byMessage.set(a.messageId, list)
    }

    set({
      messages: outcome.result.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        attachments: byMessage.get(m.id),
        usage: m.usage,
      })),
      conversationId: id,
      isStreaming: false,
      streamingId: null,
      requestId: null,
    })
  },

  resendFrom: async (messageId, newContent) => {
    const plan = planResend(get().messages, messageId, newContent)
    if (!plan) return

    // Abort first, then clear the streaming flags here rather than waiting for
    // main's `done` frame. That frame is asynchronous, so without this the
    // isStreaming guard below would still be true and the resend would be
    // silently dropped. Nulling requestId is what makes the old generation's
    // remaining frames land on nothing.
    if (get().isStreaming) await get().abort()
    set({ messages: plan.keep, isStreaming: false, streamingId: null, requestId: null })

    // Attachments are not replayed: the stored bytes are not held in the
    // renderer, and re-uploading them silently would double the cost of a
    // regenerate the user expects to be free of surprises.
    await get().sendMessage(plan.text, { truncateFromTimestamp: plan.truncateFromTimestamp })
  },

  sendMessage: async (text, opts) => {
    const ipc = window.reigan
    if (!ipc) return
    // Voice can fire multiple "final" transcript segments in quick succession
    // (e.g. holding push-to-talk). Without this guard, a second send while one
    // is still streaming overwrites streamingId and orphans the first message
    // mid-stream — it never gets its `done` event, so its cursor never clears.
    if (get().isStreaming) return

    const history = get().messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    get().addUserMessage(text, opts?.attachments)
    // Generated here rather than in main so the store can start dropping frames
    // from a previous request the instant this one begins.
    const requestId = crypto.randomUUID()
    get().startStreaming(requestId)
    useAppStore.getState().setReiganState('processing')

    try {
      await ipc.sendMessage({
        message: text,
        history,
        conversationId: get().conversationId ?? undefined,
        requestId,
        truncateFromTimestamp: opts?.truncateFromTimestamp,
        attachments: opts?.attachments,
      })
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
