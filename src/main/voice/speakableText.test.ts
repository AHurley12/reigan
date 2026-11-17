import { describe, it, expect } from 'vitest'
import { SpeakableTextBuffer, findSafeCut } from './speakableText'
import { planSpeech } from './prepareSpeech'

/** Feeds `text` one character at a time — the worst case for token boundaries. */
function streamByChar(text: string): string[] {
  const buffer = new SpeakableTextBuffer()
  const pieces: string[] = []
  for (const ch of text) {
    const out = buffer.push(ch)
    if (out) pieces.push(out)
  }
  const rest = buffer.flush()
  if (rest) pieces.push(rest)
  return pieces
}

describe('SpeakableTextBuffer', () => {
  it('releases a sentence once the next one has started', () => {
    const buffer = new SpeakableTextBuffer()
    expect(buffer.push('Hello there.')).toBe('')
    expect(buffer.push(' How')).toBe('Hello there.')
    expect(buffer.flush()).toBe(' How')
  })

  it('loses and reorders nothing, whatever the token boundaries', () => {
    const text = 'First point. Second point!\n\n- a list item\n- another\n\nDone? Yes.'
    expect(streamByChar(text).join('')).toBe(text)
  })

  it('does not cut decimals, file names, list numbers, initials or abbreviations', () => {
    for (const text of ['It costs 3.5 dollars and more', 'Open main.ts and see', '1. Install it', 'Ask J. Smith about it', 'Fruit, e.g. apples, works']) {
      expect(findSafeCut(text)).toBe(0)
    }
  })

  it('never cuts inside a code fence', () => {
    const text = 'Run this:\n```ts\nconst a = 1. Then b = 2.\nfoo()\n```\nAfter.'
    const pieces = streamByChar(text)
    expect(pieces.join('')).toBe(text)
    const fence = pieces.find((p) => p.includes('```ts'))!
    expect(fence).toContain('foo()\n```')
  })

  it('never cuts inside a table row', () => {
    expect(findSafeCut('| Item. One | Two. Three |')).toBe(0)
  })

  it('keeps a Japanese phrase together with its gloss, so the romaji is still dropped', () => {
    const text = '日本語を勉強しましょう。 (nihongo o benkyou shimashou — let us study Japanese.) Next sentence here.'
    const pieces = streamByChar(text)
    const glossPiece = pieces.find((p) => p.includes('勉強'))!
    expect(glossPiece).toContain('(nihongo')
    expect(pieces.map((p) => planSpeech(p).map((s) => s.text).join(' ')).join(' ')).not.toMatch(/benkyou/)
  })

  it('cuts Japanese sentences without needing a space', () => {
    const buffer = new SpeakableTextBuffer()
    expect(buffer.push('はい、わかりました。次は')).toBe('はい、わかりました。')
  })

  it('waits for a run of terminators to finish', () => {
    const buffer = new SpeakableTextBuffer()
    expect(buffer.push('Well..')).toBe('')
    expect(buffer.push('. So')).toBe('Well...')
  })

  it('speaks the same words streamed in pieces as it does all at once', () => {
    const text = 'Here is the plan. **Step one** is easy.\n\n| A | B |\n|---|---|\n| x | y |\n\nThat is all.'
    const whole = planSpeech(text).map((s) => s.text).join(' ')
    const pieced = streamByChar(text).flatMap((p) => planSpeech(p).map((s) => s.text)).join(' ')
    expect(pieced.replace(/\s+/g, ' ')).toBe(whole.replace(/\s+/g, ' '))
  })
})
