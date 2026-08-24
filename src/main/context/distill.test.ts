import { beforeEach, describe, expect, it, vi } from 'vitest'

// maybeDistill's fire-and-forget path touches getDecodedSetting, the fact
// store, the error log and the model client. All four are mocked so this
// file continues to load with the same plain-static-import pattern used for
// the pure functions below — no real database or Electron userData needed —
// and so the assertions below can observe exactly what maybeDistill did
// without a live network call.
const mockGetDecodedSetting = vi.fn()
vi.mock('../db/queries', () => ({
  getDecodedSetting: (...args: unknown[]) => mockGetDecodedSetting(...args),
}))

const mockListFacts = vi.fn()
const mockUpsertFact = vi.fn()
vi.mock('./store', () => ({
  listFacts: (...args: unknown[]) => mockListFacts(...args),
  upsertFact: (...args: unknown[]) => mockUpsertFact(...args),
}))

const mockRecordAppError = vi.fn()
vi.mock('../errors/errorLog', () => ({
  recordAppError: (...args: unknown[]) => mockRecordAppError(...args),
}))

const mockInvoke = vi.fn()
vi.mock('@langchain/anthropic', () => ({
  ChatAnthropic: vi.fn().mockImplementation(() => ({ invoke: mockInvoke })),
}))

import { boundedLines, maybeDistill, parseDistillResponse, resetDistillCounters, shouldDistill } from './distill'

beforeEach(() => {
  resetDistillCounters()
  mockGetDecodedSetting.mockReset()
  mockListFacts.mockReset().mockReturnValue([])
  mockUpsertFact.mockReset()
  mockRecordAppError.mockReset()
  mockInvoke.mockReset()
})

const LONG = 'x'.repeat(300)

describe('shouldDistill', () => {
  it('does not fire before the turn threshold', () => {
    expect(shouldDistill('c1', LONG)).toBe(false)
    expect(shouldDistill('c1', LONG)).toBe(false)
    expect(shouldDistill('c1', LONG)).toBe(false)
  })

  it('fires on the fourth substantive turn, then resets', () => {
    for (let i = 0; i < 3; i++) shouldDistill('c1', LONG)
    expect(shouldDistill('c1', LONG)).toBe(true)
    expect(shouldDistill('c1', LONG)).toBe(false)
  })

  it('ignores trivial exchanges entirely', () => {
    // "thanks" / "yep" carry nothing to learn and must not advance the counter,
    // or four acknowledgements in a row would trigger a pointless paid call.
    for (let i = 0; i < 10; i++) expect(shouldDistill('c1', 'thanks')).toBe(false)
    for (let i = 0; i < 3; i++) shouldDistill('c1', LONG)
    expect(shouldDistill('c1', LONG)).toBe(true)
  })

  it('counts each conversation separately', () => {
    for (let i = 0; i < 3; i++) shouldDistill('c1', LONG)
    expect(shouldDistill('c2', LONG)).toBe(false)
    expect(shouldDistill('c1', LONG)).toBe(true)
  })
})

describe('parseDistillResponse', () => {
  it('parses a well-formed array', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'duty', key: 'day-job', body: 'Works the AWP evening shift', confidence: 0.7 },
    ]))

    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'duty', key: 'day-job', source: 'distilled', confidence: 0.7 })
  })

  it('unwraps a fenced code block', () => {
    const raw = '```json\n[{"kind":"goal","key":"sie","body":"Sitting the SIE","confidence":0.6}]\n```'
    expect(parseDistillResponse(raw)).toHaveLength(1)
  })

  it('returns nothing for unparseable output', () => {
    // A model that returns prose must write zero facts, not a garbage row that
    // then gets recited back to the user as something Shingan "knows".
    expect(parseDistillResponse('Sure! Here are some observations about the user.')).toEqual([])
    expect(parseDistillResponse('')).toEqual([])
    expect(parseDistillResponse('{"not":"an array"}')).toEqual([])
  })

  it('drops entries with an unknown kind', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'vibe', key: 'a', body: 'Nope', confidence: 0.5 },
      { kind: 'goal', key: 'b', body: 'Yes', confidence: 0.5 },
    ]))

    expect(out.map((f) => f.key)).toEqual(['b'])
  })

  it('drops entries missing a key or body', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'goal', key: '', body: 'No key', confidence: 0.5 },
      { kind: 'goal', key: 'x', body: '   ', confidence: 0.5 },
      { kind: 'goal', key: 'ok', body: 'Fine', confidence: 0.5 },
    ]))

    expect(out.map((f) => f.key)).toEqual(['ok'])
  })

  it('clamps confidence into range and defaults when absent', () => {
    const out = parseDistillResponse(JSON.stringify([
      { kind: 'goal', key: 'a', body: 'High', confidence: 5 },
      { kind: 'goal', key: 'b', body: 'Negative', confidence: -2 },
      { kind: 'goal', key: 'c', body: 'Missing' },
    ]))

    expect(out[0].confidence).toBe(1)
    expect(out[1].confidence).toBe(0)
    expect(out[2].confidence).toBe(0.5)
  })

  it('caps how many facts one pass may write', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ kind: 'goal', key: `k${i}`, body: `B${i}`, confidence: 0.5 }))
    expect(parseDistillResponse(JSON.stringify(many))).toHaveLength(12)
  })
})

describe('boundedLines', () => {
  it('stops at the count bound', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `- l${i}`)
    expect(boundedLines(lines, 3, 10_000).split('\n')).toHaveLength(3)
  })

  it('stops at the character bound', () => {
    const lines = Array.from({ length: 10 }, () => 'x'.repeat(20))
    // 20 chars plus a newline each: three fit inside 70.
    expect(boundedLines(lines, 100, 70).split('\n')).toHaveLength(3)
  })

  it('keeps the head of the list, which arrives confidence-ranked', () => {
    expect(boundedLines(['high', 'mid', 'low'], 2, 10_000)).toBe('high\nmid')
  })

  it('renders an empty list as an empty string', () => {
    expect(boundedLines([], 10, 100)).toBe('')
  })
})

describe('runDistillation prompt', () => {
  function promptText(): string {
    const messages = mockInvoke.mock.calls[0][0] as Array<{ content: string }>
    return messages[0].content
  }

  it('feeds dismissed facts back as a do-not-derive list', async () => {
    // Suppressing the write alone was not enough: the model never learned the
    // fact had been rejected, re-derived the same slug from the same
    // conversation, and burned a paid call doing it on every single pass.
    mockGetDecodedSetting.mockReturnValue('false')
    mockListFacts.mockImplementation((opts?: { status?: string }) =>
      opts?.status === 'dismissed'
        ? [{ kind: 'goal', key: 'sie-exam', body: 'Wants to pass the SIE', confidence: 0.5 }]
        : [{ kind: 'duty', key: 'day-job', body: 'Works evenings', confidence: 0.9 }],
    )
    mockInvoke.mockResolvedValue({ content: '[]' })
    for (let i = 0; i < 3; i++) shouldDistill('c-prompt', LONG)

    maybeDistill('c-prompt', LONG, [{ role: 'user', content: LONG }], 'sk-test')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const prompt = promptText()
    expect(prompt).toContain('REJECTED (do not re-derive these):')
    expect(prompt).toContain('- goal/sie-exam')
    expect(prompt).toContain('- [duty/day-job] Works evenings')
  })

  it('caps the existing-fact block instead of growing with the table', async () => {
    // The digest is hard-capped at 4800 chars; this sibling input was not, and
    // nothing is ever hard-deleted, so it could only grow.
    mockGetDecodedSetting.mockReturnValue('false')
    mockListFacts.mockImplementation((opts?: { status?: string }) =>
      opts?.status === 'dismissed'
        ? []
        : Array.from({ length: 500 }, (_, i) => ({ kind: 'goal', key: `k${i}`, body: 'b'.repeat(80), confidence: 0.5 })),
    )
    mockInvoke.mockResolvedValue({ content: '[]' })
    for (let i = 0; i < 3; i++) shouldDistill('c-cap', LONG)

    maybeDistill('c-cap', LONG, [{ role: 'user', content: 'short' }], 'sk-test')
    await new Promise((resolve) => setTimeout(resolve, 0))

    const block = promptText().split('EXISTING FACTS:\n')[1].split('\n\nREJECTED')[0]
    expect(block.length).toBeLessThanOrEqual(2400)
    expect(block.split('\n').length).toBeLessThanOrEqual(40)
  })
})

describe('maybeDistill', () => {
  it('short-circuits before any work when contextLearningPaused is the string "true"', () => {
    // Settings persist as JSON.stringify(value), so a paused boolean lands in
    // SQLite as the literal string 'true' — this is the gate maybeDistill
    // actually checks, so the test drives it the same way the real store would.
    mockGetDecodedSetting.mockReturnValue('true')
    for (let i = 0; i < 3; i++) shouldDistill('c-paused', LONG) // prime the counter to fire

    maybeDistill('c-paused', LONG, [], 'sk-test')

    // No construction of the model client, and no read of the fact store —
    // proof runDistillation was never entered, not merely that it produced
    // no output.
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockListFacts).not.toHaveBeenCalled()
  })

  it('short-circuits before any work when the API key is missing', () => {
    mockGetDecodedSetting.mockReturnValue('false')
    for (let i = 0; i < 3; i++) shouldDistill('c-nokey', LONG)

    maybeDistill('c-nokey', LONG, [], '')

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockListFacts).not.toHaveBeenCalled()
  })

  it('records a missing key once, rather than failing to learn in silence', () => {
    // The key can come from the environment, in which case the settings row is
    // empty. Bailing with no record meant chat worked, the digest stayed empty
    // forever, and nothing anywhere said why.
    mockGetDecodedSetting.mockReturnValue('false')
    for (let i = 0; i < 3; i++) shouldDistill('c-warn', LONG)

    maybeDistill('c-warn', LONG, [], '')
    maybeDistill('c-warn', LONG, [], '')
    maybeDistill('c-warn', LONG, [], '')

    expect(mockRecordAppError).toHaveBeenCalledTimes(1)
    expect(mockRecordAppError).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'contextDistillation', severity: 'warning' }),
    )
  })

  it('routes a rejected runDistillation to recordAppError with severity warning, without throwing', async () => {
    mockGetDecodedSetting.mockReturnValue('false')
    mockInvoke.mockRejectedValue(new Error('upstream exploded'))
    for (let i = 0; i < 3; i++) shouldDistill('c-reject', LONG) // one more call inside maybeDistill fires it

    expect(() =>
      maybeDistill(
        'c-reject',
        LONG,
        [{ role: 'user', content: LONG }],
        'sk-test',
      ),
    ).not.toThrow()

    // maybeDistill is fire-and-forget; give the rejected invoke() and its
    // .catch() a turn of the microtask queue to run.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockRecordAppError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'llm',
        operation: 'contextDistillation',
        severity: 'warning',
        context: expect.objectContaining({ conversationId: 'c-reject' }),
      }),
    )
  })
})
