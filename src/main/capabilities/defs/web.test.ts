import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Parameters are declared even though the bodies ignore them: without them the
 * mock's call tuples type as empty, and every `mock.calls[0][1]` assertion below
 * — the options, which are the actual subject of these tests — fails to compile.
 */
type Opts = Record<string, unknown>

const search = vi.fn(async (_query: string, _options: Opts) => ({
  results: [], query: 'q', responseTime: 1, images: [], requestId: 'r',
}))
const extract = vi.fn(async (_urls: string[], _options: Opts) => ({
  results: [], failedResults: [], responseTime: 1, requestId: 'r',
}))
const crawl = vi.fn(async (_url: string, _options: Opts) => ({
  responseTime: 1, baseUrl: 'https://x.com', results: [], requestId: 'r',
}))
const map = vi.fn(async (_url: string, _options: Opts) => ({
  responseTime: 1, baseUrl: 'https://x.com', results: [], requestId: 'r',
}))

// Only the client is faked. The defaults under test live in the capability
// defs and in tavily.ts, so mocking those too would leave nothing real.
vi.mock('../../web/tavily', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../web/tavily')>()),
  getTavilyClient: () => ({ search, extract, crawl, map }),
}))

import { webCapabilities } from './web'
import { CHUNKS_PER_SOURCE, CRAWL_MAX_PAGES, MAP_MAX_PAGES, SEARCH_MAX_TOKENS } from '../../web/tavily'

const cap = (id: string) => webCapabilities.find((c) => c.id === id)!
const run = (id: string, args: unknown) => cap(id).handler(cap(id).schema.parse(args), { invokedBy: 'agent' })

beforeEach(() => {
  search.mockClear()
  extract.mockClear()
  crawl.mockClear()
  map.mockClear()
})

describe('web capability wiring', () => {
  it('registers the four operations', () => {
    expect(webCapabilities.map((c) => c.id).sort()).toEqual([
      'web.crawl',
      'web.extract',
      'web.map',
      'web.search',
    ])
  })

  /**
   * None of these change anything the user owns. Declaring a write to force a
   * prompt would put "Modifies data" on the approval card for a read, and the
   * model repeats that wording to the user.
   */
  it('keeps every operation on the network tier', () => {
    for (const c of webCapabilities) expect(c.risk).toBe('network')
  })

  it('gates the cheap operations once per conversation', () => {
    expect(cap('web.search').approvalPolicy).toBe('session')
    expect(cap('web.extract').approvalPolicy).toBe('session')
  })

  it('gates the expensive operations on every single call', () => {
    expect(cap('web.crawl').approvalPolicy).toBe('always')
    expect(cap('web.map').approvalPolicy).toBe('always')
  })

  /**
   * A grant the user did not know they were giving is not consent, so the card
   * has to say what approving covers.
   */
  it('tells the user on the card that approval covers the conversation', () => {
    const summary = cap('web.search').approval!.summary({ query: 'rust release' })

    expect(summary).toContain('rust release')
    expect(summary).toMatch(/rest of this conversation/i)
  })

  it('names the real cost on the crawl card', () => {
    const summary = cap('web.crawl').approval!.summary({ url: 'https://example.com', limit: 15 })

    expect(summary).toContain('15')
    expect(summary).toContain('https://example.com')
  })
})

/** The options that decide whether a search costs ~600 tokens or ~9,000. */
describe('web.search token discipline', () => {
  it('asks for an answer and refuses raw page text by default', async () => {
    await run('web.search', { query: 'what is rust' })

    const opts = search.mock.calls[0][1]
    expect(opts.includeAnswer).toBe('advanced')
    expect(opts.includeRawContent).toBe(false)
    expect(opts.chunksPerSource).toBe(CHUNKS_PER_SOURCE)
    expect(opts.maxTokens).toBe(SEARCH_MAX_TOKENS)
  })

  it('never asks for images, which cost context and have nowhere to render', async () => {
    await run('web.search', { query: 'anything' })

    expect(search.mock.calls[0][1].includeImages).toBe(false)
  })

  it('clamps a runaway result count', async () => {
    await run('web.search', { query: 'q', maxResults: 10 })

    expect(search.mock.calls[0][1].maxResults).toBe(10)
  })

  it('opts into full page text only when explicitly asked', async () => {
    await run('web.search', { query: 'q', fullText: true })

    expect(search.mock.calls[0][1].includeRawContent).toBe('markdown')
  })

  it('uses the cheap search depth unless deep is requested', async () => {
    await run('web.search', { query: 'q' })
    expect(search.mock.calls[0][1].searchDepth).toBe('basic')

    await run('web.search', { query: 'q', depth: 'deep' })
    expect(search.mock.calls[1][1].searchDepth).toBe('advanced')
  })

  it('passes the narrowing filters through, so a refine beats a re-search', async () => {
    await run('web.search', { query: 'q', topic: 'news', timeRange: 'week' })

    const opts = search.mock.calls[0][1]
    expect(opts.topic).toBe('news')
    expect(opts.timeRange).toBe('week')
  })
})

describe('web.extract', () => {
  it('requests markdown and refuses images', async () => {
    await run('web.extract', { urls: ['https://example.com'] })

    const opts = extract.mock.calls[0][1]
    expect(opts.format).toBe('markdown')
    expect(opts.includeImages).toBe(false)
  })

  it('refuses more than five URLs at once', () => {
    const sixUrls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`)

    expect(() => cap('web.extract').schema.parse({ urls: sixUrls })).toThrow()
  })

  it('rejects something that is not a URL', () => {
    expect(() => cap('web.extract').schema.parse({ urls: ['not a url'] })).toThrow()
  })
})

describe('web.crawl and web.map page limits', () => {
  it('caps crawl pages even if the schema were bypassed', async () => {
    await cap('web.crawl').handler({ url: 'https://x.com', limit: 9_999 }, { invokedBy: 'agent' })

    expect(crawl.mock.calls[0][1].limit).toBe(CRAWL_MAX_PAGES)
  })

  it('caps map URLs the same way', async () => {
    await cap('web.map').handler({ url: 'https://x.com', limit: 9_999 }, { invokedBy: 'agent' })

    expect(map.mock.calls[0][1].limit).toBe(MAP_MAX_PAGES)
  })

  it('defaults a crawl to a shallow, small walk', async () => {
    await run('web.crawl', { url: 'https://x.com' })

    const opts = crawl.mock.calls[0][1]
    expect(opts.limit).toBe(10)
    expect(opts.maxDepth).toBe(1)
    expect(opts.includeImages).toBe(false)
  })
})
