import type { ChatMessage, ChatStreamFrame } from '../../../shared/types'

/**
 * The part of the chat store a stream frame actually touches, split out of
 * chatStore so it can be tested without a React tree or an IPC bridge — the
 * same reason hooks/motionPreference.ts is split out of useReducedMotion.
 *
 * Vitest here runs in a node environment with no jsdom, so anything that needs
 * a DOM cannot be covered. Keeping the routing rules pure is what makes the
 * "a stopped stream's tail must not land in the next message" case testable at
 * all.
 */
export interface StreamState {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingId: string | null
  /** The send currently being listened to. Frames from any other are dropped. */
  requestId: string | null
}

/**
 * Routes one frame from `llm:stream` onto the in-flight assistant message.
 *
 * Returns the same object identity when a frame changes nothing, so a caller
 * using this inside a zustand `set` does not re-render on ignored frames.
 */
export function reduceStreamFrame(state: StreamState, frame: ChatStreamFrame): StreamState {
  // A stop followed immediately by a resend leaves the old generation still
  // draining in main. Without this guard its remaining tokens append to the new
  // message, which reads as the model repeating itself for no visible reason.
  if (state.requestId === null || frame.requestId !== state.requestId) return state

  // Nothing is being streamed into. Can happen if a frame outlives finalization.
  if (state.streamingId === null) return state

  const targetId = state.streamingId

  if (frame.event.kind === 'token') {
    const text = frame.event.text
    if (!text) return state
    return {
      ...state,
      messages: state.messages.map((m) =>
        m.id === targetId ? { ...m, content: m.content + text } : m
      ),
    }
  }

  // kind === 'done' — every reason finalizes; they differ only in what they mark.
  const reason = frame.event.reason
  const failure = frame.event.message
  return {
    ...state,
    isStreaming: false,
    streamingId: null,
    requestId: null,
    messages: state.messages.map((m) => {
      if (m.id !== targetId) return m
      const finalized: ChatMessage = { ...m, isStreaming: false }
      // A stopped reply keeps whatever text arrived. Discarding it would throw
      // away work the user already paid for, and leaves nothing for Retry to
      // anchor to.
      if (reason === 'aborted') finalized.stoppedByUser = true
      // The message text is never overwritten with the error. An error is a
      // property of the turn, not something the assistant said — rendering it
      // as content is what made failures unrecoverable before.
      if (reason === 'error') finalized.error = failure || 'Something went wrong.'
      return finalized
    }),
  }
}
