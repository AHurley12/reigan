import { beforeEach, describe, expect, it } from 'vitest'
import { parseDistillResponse, resetDistillCounters, shouldDistill } from './distill'

beforeEach(() => resetDistillCounters())

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
