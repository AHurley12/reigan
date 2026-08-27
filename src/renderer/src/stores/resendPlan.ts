import type { ChatMessage } from '../../../shared/types'

export interface ResendPlan {
  /** Messages that survive, in order. The resent user turn is NOT among them. */
  keep: ChatMessage[]
  /** Conversation history for the request — everything before the resent turn. */
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The user text to send. */
  text: string
  /** Rows at or after this timestamp are deleted from the conversation. */
  truncateFromTimestamp: number
}

/**
 * Works out what a regenerate, an edit-and-resend, or a retry actually does.
 *
 * All three are the same operation: pick a user turn, throw away everything
 * from it onward, and send it again — optionally with different text. Writing
 * them as three code paths is how they drift, so there is one plan function and
 * one caller.
 *
 * Returns null when there is nothing sensible to resend, which the caller should
 * treat as "do nothing" rather than as an error.
 */
export function planResend(
  messages: ChatMessage[],
  targetId: string,
  newContent?: string
): ResendPlan | null {
  const targetIndex = messages.findIndex((m) => m.id === targetId)
  if (targetIndex === -1) return null

  // Regenerating is expressed against the reply the user is looking at, but the
  // thing actually resent is the question that produced it.
  const userIndex =
    messages[targetIndex].role === 'user'
      ? targetIndex
      : lastUserIndexBefore(messages, targetIndex)

  if (userIndex === -1) return null

  const userTurn = messages[userIndex]
  const text = (newContent ?? userTurn.content).trim()
  if (!text) return null

  // Everything strictly before the resent turn. This mirrors the split
  // chatStore.sendMessage already performs: history is built from the messages
  // that precede the new turn, and the turn itself is sent separately. Including
  // it in both would show the model the same question twice.
  const keep = messages.slice(0, userIndex)

  return {
    keep,
    history: keep.map((m) => ({ role: m.role, content: m.content })),
    text,
    truncateFromTimestamp: userTurn.timestamp,
  }
}

function lastUserIndexBefore(messages: ChatMessage[], index: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return i
  }
  return -1
}
