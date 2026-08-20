import {
  tavily,
  type TavilyCrawlResponse,
  type TavilyExtractResponse,
  type TavilyMapResponse,
  type TavilySearchResponse,
} from '@tavily/core'
import { getDecodedSetting } from '../db/queries'
import { CapabilityError } from '../capabilities/types'

/**
 * Tavily client and the defaults that keep a search cheap.
 *
 * The capability defs stay declarative by keeping every tuning decision here:
 * what a "quick" search means, how much page text is allowed back, how results
 * are rendered for the model. Those are one subject, and they are the subject
 * that decides whether web search costs 600 tokens or 9,000.
 *
 * The governing idea is that **the model should read an answer, not a corpus**.
 * Tavily can synthesise an answer from the results it found, so the default
 * shape is that answer plus short per-result snippets. Full page text is
 * available, but only when the caller asks for it by name.
 */

/** Guards a runaway `maxResults` from the model. */
export const MAX_RESULTS_CEILING = 10
export const DEFAULT_MAX_RESULTS = 5

/**
 * Hard ceiling on the content Tavily returns, enforced server-side.
 *
 * A backstop rather than the main defence — `includeRawContent: false` is what
 * normally keeps responses small. This catches the case where the caller has
 * opted into raw content and hit a set of unusually long pages.
 */
export const SEARCH_MAX_TOKENS = 4_000

/** Snippets per source when raw content is off. Two is enough to judge relevance. */
export const CHUNKS_PER_SOURCE = 2

/** Per-URL truncation for extract, in characters. */
export const EXTRACT_MAX_CHARS = 12_000

/** Crawl and map are the expensive calls; these keep one from running away. */
export const CRAWL_MAX_PAGES = 20
export const MAP_MAX_PAGES = 50

export type SearchDepth = 'quick' | 'deep'

/**
 * Returns a configured client, or explains what is missing.
 *
 * `not_connected` rather than a generic failure: the registry turns that into a
 * message the model reads and relays, so an absent key surfaces to the user as
 * "add a Tavily key in Settings" instead of an opaque error.
 */
export function getTavilyClient(): ReturnType<typeof tavily> {
  const apiKey = getDecodedSetting('tavilyApiKey') ?? process.env.TAVILY_API_KEY ?? ''

  if (!apiKey) {
    throw new CapabilityError(
      'No Tavily API key is configured. Add one in Settings (Ctrl+,) to enable web search.',
      'not_connected'
    )
  }

  return tavily({ apiKey, clientName: 'shingan' })
}

export function clampResults(requested: number | undefined): number {
  if (!requested || requested < 1) return DEFAULT_MAX_RESULTS
  return Math.min(requested, MAX_RESULTS_CEILING)
}

/**
 * Renders a search response for the model as markdown.
 *
 * This function is the single largest token saving in the feature, which is why
 * it exists rather than letting the registry fall back to `JSON.stringify`. A
 * Tavily response serialised as JSON spends a large share of its tokens on
 * braces, quotes and the same dozen keys repeated per result, and buries the
 * synthesised answer somewhere in the middle. Rendering it puts the answer
 * first — often all the model needs — and reduces each result to the three
 * fields that decide whether it is worth opening.
 */
export function formatSearchResult(response: TavilySearchResponse): string {
  const lines: string[] = []

  if (response.answer) {
    lines.push(response.answer, '')
  }

  if (!response.results?.length) {
    lines.push('No results.')
    return lines.join('\n')
  }

  lines.push('Sources:')
  response.results.forEach((r, i) => {
    const dated = r.publishedDate ? ` (${r.publishedDate})` : ''
    lines.push(`${i + 1}. ${r.title}${dated} — ${r.url}`)

    // Present when raw content is off, which is the default; the snippet is what
    // the model uses to decide whether the page is worth extracting in full.
    if (r.content) lines.push(`   ${r.content.trim()}`)
  })

  return lines.join('\n')
}

function clip(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > EXTRACT_MAX_CHARS
    ? `${trimmed.slice(0, EXTRACT_MAX_CHARS)}\n\n[truncated — page continues]`
    : trimmed
}

export function formatExtractResult(response: TavilyExtractResponse): string {
  const lines: string[] = []

  for (const r of response.results ?? []) {
    const heading = r.title ? `## ${r.title}\n${r.url}` : `## ${r.url}`
    lines.push(heading, '', clip(r.rawContent ?? '') || '[no readable content]', '')
  }

  // Reported rather than swallowed. Without this the model answers from the
  // pages that worked and never mentions the one that didn't, which reads to
  // the user as a complete answer when it is a partial one.
  for (const f of response.failedResults ?? []) {
    lines.push(`## ${f.url}`, '', `[could not be read: ${f.error}]`, '')
  }

  return lines.join('\n').trim() || 'Nothing could be read from those URLs.'
}

export function formatCrawlResult(response: TavilyCrawlResponse): string {
  if (!response.results?.length) return `Nothing was crawled from ${response.baseUrl}.`

  const lines = [`Crawled ${response.results.length} page(s) from ${response.baseUrl}.`, '']

  for (const r of response.results) {
    lines.push(`## ${r.url}`, '', clip(r.rawContent ?? '') || '[no readable content]', '')
  }

  return lines.join('\n').trim()
}

/**
 * Map returns URLs only, so it stays cheap in context no matter how large the
 * site — the whole point of preferring it over a crawl when the question is
 * "what is on this site" rather than "what does it say".
 */
export function formatMapResult(response: TavilyMapResponse): string {
  if (!response.results?.length) return `No URLs were found under ${response.baseUrl}.`

  return [
    `${response.results.length} URL(s) under ${response.baseUrl}:`,
    ...response.results.map((url) => `- ${url}`),
  ].join('\n')
}
