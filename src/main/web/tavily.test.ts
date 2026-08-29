import { describe, it, expect, vi } from 'vitest'
import type { TavilyExtractResponse, TavilySearchResponse } from '@tavily/core'
import {
  DEFAULT_MAX_RESULTS,
  EXTRACT_MAX_CHARS,
  MAX_RESULTS_CEILING,
  clampResults,
  formatExtractResult,
  formatMapResult,
  formatSearchResult,
  getTavilyClient,
} from './tavily'

vi.mock('../db/queries', () => ({
  getDecodedSetting: vi.fn(() => null),
}))
import { getDecodedSetting } from '../db/queries'

/**
 * The formatters are where this feature's token budget is actually decided, so
 * they are what these tests hold still. The registry calls `formatResult`
 * before a result reaches the model; if these ever fall back to JSON, a search
 * silently costs several times what it should, and nothing else would notice.
 */

function searchResponse(overrides: Partial<TavilySearchResponse> = {}): TavilySearchResponse {
  return {
    query: 'q',
    responseTime: 1,
    images: [],
    results: [],
    requestId: 'req',
    ...overrides,
  } as TavilySearchResponse
}

describe('clampResults', () => {
  it('defaults rather than letting the model omit a bound', () => {
    expect(clampResults(undefined)).toBe(DEFAULT_MAX_RESULTS)
  })

  it('caps a runaway request', () => {
    expect(clampResults(500)).toBe(MAX_RESULTS_CEILING)
  })

  it('honours a reasonable request', () => {
    expect(clampResults(3)).toBe(3)
  })

  it('treats a nonsense count as absent instead of erroring', () => {
    expect(clampResults(0)).toBe(DEFAULT_MAX_RESULTS)
    expect(clampResults(-4)).toBe(DEFAULT_MAX_RESULTS)
  })
})

describe('formatSearchResult', () => {
  it('leads with the synthesised answer, which is often all the model needs', () => {
    const out = formatSearchResult(
      searchResponse({
        answer: 'Rust 1.90 shipped in September.',
        results: [
          {
            title: 'Release notes',
            url: 'https://example.com/rust',
            content: 'Details.',
            score: 1,
            publishedDate: '2026-09-01',
            id: '1',
          },
        ],
      })
    )

    expect(out.startsWith('Rust 1.90 shipped in September.')).toBe(true)
  })

  it('renders sources as prose, never as JSON', () => {
    const out = formatSearchResult(
      searchResponse({
        answer: 'An answer.',
        results: [
          {
            title: 'A title',
            url: 'https://example.com/a',
            content: 'A snippet.',
            score: 0.9,
            publishedDate: '2026-01-01',
            id: '1',
          },
        ],
      })
    )

    expect(out).toContain('1. A title (2026-01-01) — https://example.com/a')
    expect(out).toContain('A snippet.')

    // The point of the whole function: no serialised object, and none of the
    // per-result noise the model is billed for but never uses.
    expect(out).not.toContain('{')
    expect(out).not.toContain('"score"')
    expect(out).not.toContain('requestId')
  })

  it('says so plainly when nothing was found', () => {
    expect(formatSearchResult(searchResponse())).toContain('No results.')
  })
})

describe('formatExtractResult', () => {
  const extractResponse = (o: Partial<TavilyExtractResponse>): TavilyExtractResponse =>
    ({ results: [], failedResults: [], responseTime: 1, requestId: 'r', ...o }) as TavilyExtractResponse

  it('truncates a long page instead of flooding the context window', () => {
    const out = formatExtractResult(
      extractResponse({
        results: [
          { url: 'https://example.com', title: 'Long', rawContent: 'x'.repeat(EXTRACT_MAX_CHARS + 5_000) },
        ],
      })
    )

    expect(out).toContain('[truncated — page continues]')
    expect(out.length).toBeLessThan(EXTRACT_MAX_CHARS + 500)
  })

  /**
   * Without this the model answers from the pages that worked and never
   * mentions the one that didn't, which reads to the user as a complete answer
   * when it is a partial one.
   */
  it('reports a page it could not read rather than dropping it', () => {
    const out = formatExtractResult(
      extractResponse({
        results: [{ url: 'https://ok.com', title: 'Fine', rawContent: 'Body.' }],
        failedResults: [{ url: 'https://blocked.com', error: '403 Forbidden' }],
      })
    )

    expect(out).toContain('https://blocked.com')
    expect(out).toContain('403 Forbidden')
  })
})

describe('formatMapResult', () => {
  it('lists URLs only, which is what keeps a map cheap next to a crawl', () => {
    const out = formatMapResult({
      responseTime: 1,
      baseUrl: 'https://example.com',
      results: ['https://example.com/a', 'https://example.com/b'],
      requestId: 'r',
    })

    expect(out).toContain('2 URL(s) under https://example.com')
    expect(out).toContain('- https://example.com/a')
  })
})

describe('getTavilyClient', () => {
  it('explains the missing key instead of failing opaquely', () => {
    vi.mocked(getDecodedSetting).mockReturnValue(null)
    const previous = process.env.TAVILY_API_KEY
    delete process.env.TAVILY_API_KEY

    try {
      expect(() => getTavilyClient()).toThrow(/Tavily API key/)
      // `not_connected` is what turns this into a message the model relays to
      // the user, rather than a generic tool failure it might retry.
      expect(() => getTavilyClient()).toThrow(
        expect.objectContaining({ code: 'not_connected' })
      )
    } finally {
      if (previous !== undefined) process.env.TAVILY_API_KEY = previous
    }
  })
})
