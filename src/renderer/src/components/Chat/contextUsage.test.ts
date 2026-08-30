import { describe, expect, it } from 'vitest'
import { CRITICAL_AT, formatTokens, readContextUsage, WARN_AT } from './contextUsage'
import type { ChatMessage } from '../../../../shared/types'

const WINDOW = 200_000

let seq = 0
function msg(usage?: { inputTokens: number; outputTokens: number }): ChatMessage {
  seq += 1
  return {
    id: `m${seq}`,
    role: seq % 2 === 1 ? 'user' : 'assistant',
    content: 'x',
    timestamp: 1_700_000_000_000 + seq,
    usage: usage ? { ...usage, model: 'claude-sonnet-4-6' } : undefined,
  }
}

describe('nothing measured yet', () => {
  it('returns null rather than guessing', () => {
    expect(readContextUsage([], WINDOW)).toBeNull()
    expect(readContextUsage([msg(), msg()], WINDOW)).toBeNull()
  })

  it('returns null for a model with no known window', () => {
    expect(readContextUsage([msg({ inputTokens: 10, outputTokens: 10 })], 0)).toBeNull()
  })
})

describe('reading the latest measurement', () => {
  it('counts the last request plus its reply, since the reply becomes history', () => {
    const reading = readContextUsage([msg({ inputTokens: 1000, outputTokens: 500 })], WINDOW)!

    expect(reading.used).toBe(1500)
  })

  it('does not sum turns, which would count the same history repeatedly', () => {
    // The regression this guards: each input count already includes the whole
    // history sent with it. Adding them would multiply the load several times.
    const messages = [
      msg({ inputTokens: 1000, outputTokens: 200 }),
      msg({ inputTokens: 4000, outputTokens: 300 }),
    ]

    expect(readContextUsage(messages, WINDOW)!.used).toBe(4300)
  })

  it('ignores later messages that carry no measurement', () => {
    const messages = [msg({ inputTokens: 8000, outputTokens: 100 }), msg(), msg()]

    expect(readContextUsage(messages, WINDOW)!.used).toBe(8100)
  })
})

describe('bands', () => {
  const at = (fraction: number) =>
    readContextUsage([msg({ inputTokens: Math.round(WINDOW * fraction), outputTokens: 0 })], WINDOW)!

  it('is ok well below the threshold', () => {
    expect(at(0.1).band).toBe('ok')
  })

  it('warns from the warn threshold', () => {
    expect(at(WARN_AT).band).toBe('warn')
    expect(at(WARN_AT - 0.01).band).toBe('ok')
  })

  it('is critical from the critical threshold', () => {
    expect(at(CRITICAL_AT).band).toBe('critical')
    expect(at(CRITICAL_AT - 0.01).band).toBe('warn')
  })

  it('clamps rather than reporting more than a full window', () => {
    const reading = readContextUsage([msg({ inputTokens: WINDOW * 3, outputTokens: 0 })], WINDOW)!

    expect(reading.fraction).toBe(1)
    expect(reading.band).toBe('critical')
  })

  it('gives every band a text label, so colour is never the only cue', () => {
    for (const fraction of [0.1, WARN_AT, CRITICAL_AT]) {
      expect(at(fraction).label.length).toBeGreaterThan(0)
    }
    expect(at(0.1).label).not.toBe(at(CRITICAL_AT).label)
  })
})

describe('formatTokens', () => {
  it('shows small counts exactly', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(999)).toBe('999')
  })

  it('keeps one decimal below ten thousand and none above', () => {
    expect(formatTokens(1500)).toBe('1.5k')
    expect(formatTokens(9900)).toBe('9.9k')
    expect(formatTokens(24_500)).toBe('25k')
    expect(formatTokens(200_000)).toBe('200k')
  })
})
