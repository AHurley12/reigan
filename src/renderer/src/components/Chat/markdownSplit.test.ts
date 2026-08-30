import { describe, expect, it } from 'vitest'
import { splitStreamedMarkdown } from './markdownSplit'

describe('nothing complete yet', () => {
  it('keeps a single unfinished paragraph in the tail', () => {
    expect(splitStreamedMarkdown('Here is the ans')).toEqual({ settled: '', tail: 'Here is the ans' })
  })

  it('handles an empty stream', () => {
    expect(splitStreamedMarkdown('')).toEqual({ settled: '', tail: '' })
  })
})

describe('complete blocks are promoted', () => {
  it('settles a finished paragraph and leaves the next one arriving', () => {
    const { settled, tail } = splitStreamedMarkdown('First paragraph.\n\nSecond para')

    expect(settled).toBe('First paragraph.\n\n')
    expect(tail).toBe('Second para')
  })

  it('settles everything up to the last blank line', () => {
    const { settled, tail } = splitStreamedMarkdown('One.\n\nTwo.\n\nThree arriv')

    expect(settled).toBe('One.\n\nTwo.\n\n')
    expect(tail).toBe('Three arriv')
  })
})

describe('code fences', () => {
  it('holds an unterminated fence back entirely', () => {
    // The regression this guards: rendering a half-written fence as markdown
    // shows three literal backticks until the closing fence arrives.
    const { settled, tail } = splitStreamedMarkdown('Intro line.\n\n```ts\nconst a = 1')

    expect(settled).toBe('Intro line.\n\n')
    expect(tail).toBe('```ts\nconst a = 1')
  })

  it('does not treat a blank line inside a fence as a boundary', () => {
    const { tail } = splitStreamedMarkdown('Intro.\n\n```ts\nconst a = 1\n\nconst b = 2')

    expect(tail).toBe('```ts\nconst a = 1\n\nconst b = 2')
  })

  it('promotes a fence once it has closed and a blank line follows', () => {
    const { settled, tail } = splitStreamedMarkdown('```ts\nconst a = 1\n```\n\nNext par')

    expect(settled).toBe('```ts\nconst a = 1\n```\n\n')
    expect(tail).toBe('Next par')
  })

  it('settles nothing when the reply opens with an unterminated fence', () => {
    expect(splitStreamedMarkdown('```py\nx = 1')).toEqual({ settled: '', tail: '```py\nx = 1' })
  })

  it('recognises tilde fences too', () => {
    expect(splitStreamedMarkdown('Intro.\n\n~~~\nraw').settled).toBe('Intro.\n\n')
  })

  it('is not fooled by a partially typed fence marker', () => {
    // Two backticks is not a fence, so it must not flip the state and swallow
    // the rest of the reply.
    const { settled, tail } = splitStreamedMarkdown('Intro.\n\nSecond.\n\n``')

    expect(settled).toBe('Intro.\n\nSecond.\n\n')
    expect(tail).toBe('``')
  })
})

describe('constructs that need their whole shape to render', () => {
  it('holds a table back until it is finished', () => {
    // A table without its separator row renders as a paragraph of pipes.
    const { settled, tail } = splitStreamedMarkdown('Intro.\n\n| a | b |\n| - | - |\n| 1 |')

    expect(settled).toBe('Intro.\n\n')
    expect(tail).toBe('| a | b |\n| - | - |\n| 1 |')
  })

  it('holds a list back until it is finished', () => {
    expect(splitStreamedMarkdown('Intro.\n\n- one\n- tw').tail).toBe('- one\n- tw')
  })

  it('holds an unclosed emphasis run back with its paragraph', () => {
    expect(splitStreamedMarkdown('Intro.\n\nThis is **importa').tail).toBe('This is **importa')
  })
})

describe('losslessness', () => {
  // The contract the renderer depends on: the two halves are rendered next to
  // each other, so anything other than an exact partition shows a character
  // going missing or being doubled for a frame.
  const samples = [
    '',
    'plain',
    'a\n\nb',
    'a\n\nb\n\nc',
    '```ts\nx',
    'a\n\n```ts\nx\n```\n\nb',
    'a\n\n| x | y |\n| - | - |',
    'a\n\n\n\nb',
    'trailing blank\n\n',
    '\n\n',
    'a\n',
  ]

  it('never drops or duplicates a character', () => {
    for (const sample of samples) {
      const { settled, tail } = splitStreamedMarkdown(sample)
      expect(settled + tail, JSON.stringify(sample)).toBe(sample)
    }
  })
})
