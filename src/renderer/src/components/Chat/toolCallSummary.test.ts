import { describe, expect, it } from 'vitest'
import { formatDuration, mergeToolCall, summariseToolCalls } from './toolCallSummary'
import type { ToolCallEvent } from '../../../../shared/types'

const start = (id: string, seq: number, name = 'localhost_scan'): ToolCallEvent => ({
  id,
  seq,
  name,
  status: 'running',
  argsPreview: '{"probeHttp":false}',
  resultPreview: null,
  durationMs: null,
})

const end = (id: string, seq: number, status: 'ok' | 'error' = 'ok'): ToolCallEvent => ({
  id,
  seq,
  name: 'localhost_scan',
  status,
  argsPreview: null,
  resultPreview: status === 'ok' ? '3 ports' : 'boom',
  durationMs: 240,
})

describe('pairing the two halves of a tool call', () => {
  it('does not append the end as a second row', () => {
    // The regression this guards: without merging, every tool shows twice, one
    // of them spinning forever.
    const list = mergeToolCall(mergeToolCall(undefined, start('a', 1)), end('a', 1))

    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('ok')
  })

  it('keeps the arguments the start carried, which the end does not', () => {
    const list = mergeToolCall(mergeToolCall(undefined, start('a', 1)), end('a', 1))

    expect(list[0].argsPreview).toBe('{"probeHttp":false}')
    expect(list[0].resultPreview).toBe('3 ports')
    expect(list[0].durationMs).toBe(240)
  })

  it('records a failure rather than dropping it', () => {
    const list = mergeToolCall(mergeToolCall(undefined, start('a', 1)), end('a', 1, 'error'))

    expect(list[0].status).toBe('error')
    expect(list[0].resultPreview).toBe('boom')
  })
})

describe('ordering', () => {
  it('renders tools in the order they ran, not the order events arrived', () => {
    let list = mergeToolCall(undefined, start('b', 2, 'shell_run'))
    list = mergeToolCall(list, start('a', 1))

    expect(list.map((c) => c.seq)).toEqual([1, 2])
  })

  it('leaves an updated row where it was', () => {
    let list = mergeToolCall(undefined, start('a', 1))
    list = mergeToolCall(list, start('b', 2, 'shell_run'))
    list = mergeToolCall(list, end('a', 1))

    expect(list.map((c) => c.id)).toEqual(['a', 'b'])
  })
})

describe('the collapsed header', () => {
  it('is present tense while a tool is still running', () => {
    expect(summariseToolCalls([start('a', 1)]).label).toBe('Running 1 tool…')
    expect(summariseToolCalls([start('a', 1), start('b', 2)]).label).toBe('Running 2 tools…')
  })

  it('is past tense once everything has finished', () => {
    expect(summariseToolCalls([end('a', 1)]).label).toBe('Used 1 tool')
    expect(summariseToolCalls([end('a', 1), end('b', 2)]).label).toBe('Used 2 tools')
  })

  it('says so in words when something failed, rather than only tinting it', () => {
    const summary = summariseToolCalls([end('a', 1), end('b', 2, 'error')])

    expect(summary.failed).toBe(1)
    expect(summary.label).toBe('Used 2 tools · 1 failed')
  })

  it('counts an empty list as nothing used', () => {
    expect(summariseToolCalls([])).toMatchObject({ total: 0, running: 0, failed: 0 })
  })
})

describe('formatDuration', () => {
  it('uses milliseconds below a second', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('switches to seconds above one, dropping the decimal when it stops mattering', () => {
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(24_000)).toBe('24s')
  })

  it('returns null when there is nothing to show, rather than "NaNms"', () => {
    expect(formatDuration(null)).toBeNull()
    expect(formatDuration(NaN)).toBeNull()
    expect(formatDuration(-5)).toBeNull()
  })
})
