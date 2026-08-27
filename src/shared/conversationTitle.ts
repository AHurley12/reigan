/** Longest title the sidebar can show without truncating in CSS. */
export const MAX_TITLE_LENGTH = 60

export const FALLBACK_TITLE = 'New Conversation'

/**
 * Derives a conversation title from its opening message.
 *
 * Deliberately not a model call. Asking the model to name every conversation
 * costs a request and a round trip before the user's actual question is even
 * answered, and gets it wrong often enough to need a rename anyway — which the
 * `chat.renameConversation` capability already provides. The first line of what
 * someone asked is a good title almost every time.
 */
export function deriveConversationTitle(firstMessage: string): string {
  // Newlines and runs of spaces would otherwise render as gaps in the sidebar.
  const normalized = firstMessage.replace(/\s+/g, ' ').trim()
  if (!normalized) return FALLBACK_TITLE

  if (normalized.length <= MAX_TITLE_LENGTH) return normalized

  const clipped = normalized.slice(0, MAX_TITLE_LENGTH)
  const lastSpace = clipped.lastIndexOf(' ')

  // Cutting at a space keeps the title readable. A single very long token has
  // no space to cut at, so it is clipped mid-word rather than thrown away.
  const body = lastSpace > MAX_TITLE_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped

  return `${body.trimEnd()}…`
}
