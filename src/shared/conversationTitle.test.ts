import { describe, expect, it } from 'vitest'
import { deriveConversationTitle, FALLBACK_TITLE, MAX_TITLE_LENGTH } from './conversationTitle'

describe('deriving a title from the opening message', () => {
  it('uses a short message unchanged', () => {
    expect(deriveConversationTitle('How do I rotate the API key?')).toBe('How do I rotate the API key?')
  })

  it('collapses newlines and runs of spaces so the sidebar has no gaps', () => {
    expect(deriveConversationTitle('  fix   the\n\nvoice  bug ')).toBe('fix the voice bug')
  })

  it('falls back when the message is empty or only whitespace', () => {
    expect(deriveConversationTitle('')).toBe(FALLBACK_TITLE)
    expect(deriveConversationTitle('   \n\t ')).toBe(FALLBACK_TITLE)
  })
})

describe('long messages', () => {
  const long =
    'Please walk me through every step required to migrate the database schema without losing the existing rows'

  it('never exceeds the sidebar budget', () => {
    // The ellipsis is one character, so the result can be MAX + 1 at most.
    expect(deriveConversationTitle(long).length).toBeLessThanOrEqual(MAX_TITLE_LENGTH + 1)
  })

  it('cuts at a word boundary rather than mid-word', () => {
    const title = deriveConversationTitle(long)

    expect(title.endsWith('…')).toBe(true)
    expect(title.slice(0, -1)).toBe(title.slice(0, -1).trimEnd())
    expect(long.startsWith(title.slice(0, -1))).toBe(true)
  })

  it('clips a single unbroken token instead of returning almost nothing', () => {
    // No space to cut at. Falling back to the word-boundary rule here would
    // produce an empty title, which is worse than a clipped one.
    const title = deriveConversationTitle('a'.repeat(200))

    expect(title).toBe(`${'a'.repeat(MAX_TITLE_LENGTH)}…`)
  })

  it('keeps a message that is exactly at the limit whole', () => {
    const exact = 'x'.repeat(MAX_TITLE_LENGTH)

    expect(deriveConversationTitle(exact)).toBe(exact)
  })
})
