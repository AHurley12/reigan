import { z } from 'zod'
import {
  CHUNKS_PER_SOURCE,
  CRAWL_MAX_PAGES,
  MAP_MAX_PAGES,
  SEARCH_MAX_TOKENS,
  clampResults,
  formatCrawlResult,
  formatExtractResult,
  formatMapResult,
  formatSearchResult,
  getTavilyClient,
} from '../../web/tavily'
import type { AnyCapability } from '../types'

/**
 * Web capabilities, backed by Tavily.
 *
 * Split across two approval policies, which is the design rather than an
 * accident of tiers:
 *
 *   search / extract — `approvalPolicy: 'session'`. A research turn calls these
 *     repeatedly, and a card per call would train the reflex of approving
 *     without reading, which costs more safety than it buys.
 *
 *   crawl / map      — `approvalPolicy: 'always'`. These walk a whole domain.
 *     Their cost is bounded by page limits rather than by a single fetch, so
 *     each one is worth its own decision even mid-conversation.
 *
 * All four are `risk: 'network'`. None of them changes anything the user owns,
 * and saying otherwise on the approval card would be a lie told for
 * convenience — the prompt comes from the policy instead.
 */

const searchSchema = z.object({
  query: z.string().min(1).describe('What to search for. A natural-language question works best.'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .describe('How many results to return. Defaults to 5; more costs more context.'),
  topic: z
    .enum(['general', 'news', 'finance'])
    .optional()
    .describe("Narrows the index. Use 'news' for current events, 'finance' for markets."),
  timeRange: z
    .enum(['day', 'week', 'month', 'year'])
    .optional()
    .describe('Only return results published within this window.'),
  depth: z
    .enum(['quick', 'deep'])
    .optional()
    .describe(
      "'quick' (default) returns an answer plus snippets. 'deep' searches harder and costs more; " +
        'use it only when a quick search already came back thin.'
    ),
  includeDomains: z
    .array(z.string())
    .optional()
    .describe('Restrict results to these domains, e.g. ["arxiv.org"].'),
  excludeDomains: z.array(z.string()).optional().describe('Never return results from these domains.'),
  fullText: z
    .boolean()
    .optional()
    .describe(
      'Return the full page text of each result rather than a snippet. Expensive — leave off and ' +
        'use the extract tool on the one URL you actually need.'
    ),
})

type SearchArgs = z.infer<typeof searchSchema>

const extractSchema = z.object({
  urls: z
    .array(z.string().url())
    .min(1)
    .max(5)
    .describe('The URLs to read, as clean markdown. Up to five at once.'),
  query: z
    .string()
    .optional()
    .describe('What you are looking for on the page. Focuses extraction on the relevant parts.'),
})

type ExtractArgs = z.infer<typeof extractSchema>

const crawlSchema = z.object({
  url: z.string().url().describe('The URL to start crawling from.'),
  instructions: z
    .string()
    .optional()
    .describe('Plain-language guidance on what to look for, e.g. "the pricing and billing pages".'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(CRAWL_MAX_PAGES)
    .optional()
    .describe(`Maximum pages to fetch. Defaults to 10, hard cap ${CRAWL_MAX_PAGES}.`),
  maxDepth: z.number().int().min(1).max(3).optional().describe('How many links deep to follow.'),
})

type CrawlArgs = z.infer<typeof crawlSchema>

const mapSchema = z.object({
  url: z.string().url().describe('The site to map.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAP_MAX_PAGES)
    .optional()
    .describe(`Maximum URLs to return. Defaults to 30, hard cap ${MAP_MAX_PAGES}.`),
  instructions: z.string().optional().describe('Plain-language guidance on which areas matter.'),
})

type MapArgs = z.infer<typeof mapSchema>

export const webCapabilities: AnyCapability[] = [
  {
    id: 'web.search',
    title: 'Search the web',
    description:
      'Search the live web and get a synthesised answer plus the sources it came from. Use this ' +
      'whenever the answer depends on current information — prices, news, releases, library ' +
      'versions, documentation — or on anything you are not confident about. Returns a short ' +
      'answer and a handful of results with snippets; call the web.extract tool afterwards if you ' +
      'need the full text of a specific result.',
    risk: 'network',
    approvalPolicy: 'session',
    schema: searchSchema,
    approval: {
      summary: (a: SearchArgs) =>
        `Search the web for “${a.query}”. Approving allows web searches for the rest of this conversation.`,
    },
    handler: async (args: SearchArgs) => {
      const client = getTavilyClient()

      return client.search(args.query, {
        maxResults: clampResults(args.maxResults),
        searchDepth: args.depth === 'deep' ? 'advanced' : 'basic',
        topic: args.topic,
        timeRange: args.timeRange,
        includeDomains: args.includeDomains,
        excludeDomains: args.excludeDomains,

        // The token story, in three options. An answer means the model usually
        // needs nothing else; raw content stays off unless asked for; and
        // maxTokens is the backstop for when it is asked for.
        includeAnswer: 'advanced',
        includeRawContent: args.fullText ? 'markdown' : false,
        chunksPerSource: CHUNKS_PER_SOURCE,
        maxTokens: SEARCH_MAX_TOKENS,

        // Images cost context and there is nowhere in the chat to show them.
        includeImages: false,
      })
    },
    formatResult: formatSearchResult,
  },

  {
    id: 'web.extract',
    title: 'Read a web page',
    description:
      'Read the full contents of specific URLs as clean markdown. Use this after a search when a ' +
      'result looks worth reading in full, or when the user gives you a link. Long pages are ' +
      'truncated. Pass a query to focus extraction on the part you care about.',
    risk: 'network',
    approvalPolicy: 'session',
    schema: extractSchema,
    approval: {
      summary: (a: ExtractArgs) =>
        a.urls.length === 1
          ? `Read ${a.urls[0]}. Approving allows reading web pages for the rest of this conversation.`
          : `Read ${a.urls.length} web pages. Approving allows reading web pages for the rest of this conversation.`,
    },
    handler: async (args: ExtractArgs) => {
      const client = getTavilyClient()

      return client.extract(args.urls, {
        format: 'markdown',
        extractDepth: 'basic',
        query: args.query,
        chunksPerSource: CHUNKS_PER_SOURCE,
        includeImages: false,
      })
    },
    formatResult: formatExtractResult,
  },

  {
    id: 'web.crawl',
    title: 'Crawl a website',
    description:
      'Follow links from a starting URL and read multiple pages of a site. Use this only when one ' +
      'page is genuinely not enough — it is far more expensive than search or extract, and needs ' +
      "the user's approval every single time. Prefer web.map when you only need to know what pages " +
      'exist rather than what they say.',
    risk: 'network',
    approvalPolicy: 'always',
    schema: crawlSchema,
    approval: {
      summary: (a: CrawlArgs) =>
        `Crawl up to ${a.limit ?? 10} pages starting from ${a.url}` +
        (a.instructions ? `, looking for: ${a.instructions}.` : '.'),
    },
    handler: async (args: CrawlArgs) => {
      const client = getTavilyClient()

      return client.crawl(args.url, {
        limit: Math.min(args.limit ?? 10, CRAWL_MAX_PAGES),
        maxDepth: args.maxDepth ?? 1,
        instructions: args.instructions,
        format: 'markdown',
        extractDepth: 'basic',
        chunksPerSource: CHUNKS_PER_SOURCE,
        includeImages: false,
      })
    },
    formatResult: formatCrawlResult,
  },

  {
    id: 'web.map',
    title: 'Map a website',
    description:
      'List the URLs that exist under a site without reading their contents. Much cheaper than ' +
      'crawling, and usually the right first move when exploring an unfamiliar site — map it, then ' +
      "extract the two or three pages that matter. Needs the user's approval every time.",
    risk: 'network',
    approvalPolicy: 'always',
    schema: mapSchema,
    approval: {
      summary: (a: MapArgs) => `Map up to ${a.limit ?? 30} URLs on ${a.url}.`,
    },
    handler: async (args: MapArgs) => {
      const client = getTavilyClient()

      return client.map(args.url, {
        limit: Math.min(args.limit ?? 30, MAP_MAX_PAGES),
        instructions: args.instructions,
      })
    },
    formatResult: formatMapResult,
  },
]
