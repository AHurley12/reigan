/**
 * Anthropic server-side web tools — live search and URL reading.
 *
 * These are the one deliberate exception to "new tools must be capabilities".
 * A capability (main/capabilities/defs) is a local handler the registry
 * dispatches, audits, and gates behind approval. A server tool has none of that
 * to hold: search and fetch run inside Anthropic's infrastructure, and their
 * results come back as content blocks in the same response without ever
 * touching this process. There is no handler to register, so registering one
 * would mean writing a fake handler purely to satisfy the shape.
 *
 * The trade is worth stating plainly, because it is invisible from the UI:
 * these calls produce no audit-log entry, do not defer when the machine is
 * offline, and cannot reach localhost, the user's LAN, or anything behind a
 * login. If any of those start to matter, the replacement is a real
 * `network`-tier capability pair backed by a search API — the model-facing tool
 * names stay `web_search` / `web_fetch` either way, so the swap costs nothing
 * upstream.
 */

/**
 * The model the agent runs on.
 *
 * It lives here rather than next to the ChatAnthropic constructor because the
 * web tools are versioned against it: the `_20260209` variants exist only on
 * newer models, and sending one to a model that predates it is a 400. Keeping
 * the model and the variant resolver in the same module means they cannot drift
 * apart in a way that only shows up as a runtime error on the user's machine.
 */
export const AGENT_MODEL = 'claude-sonnet-4-6'

/**
 * A server tool definition as Anthropic's API expects it.
 *
 * Intentionally not LangChain's `ToolDefinition` — that type describes a tool
 * with an `input_schema` that the client executes. These carry no schema; the
 * `type` is the contract, and ChatAnthropic forwards them verbatim.
 */
export interface AnthropicServerTool {
  type: string
  name: string
  [option: string]: unknown
}

/**
 * Models carrying the 2026-02-09 web tools, which added dynamic filtering.
 *
 * Anything absent from this set is treated as older, not as unsupported — see
 * `buildServerTools` for what that downgrades to.
 */
const DYNAMIC_FILTERING_MODELS = new Set([
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
])

export function supportsDynamicFiltering(model: string): boolean {
  return DYNAMIC_FILTERING_MODELS.has(model)
}

/**
 * Caps on how far the model can run each tool within a single turn.
 *
 * Search is billed per use, and fetched pages land in the context window whole,
 * so both need a ceiling that is not "however many the model felt like". Five
 * of each comfortably covers "search, read the two promising results, answer"
 * without letting one question quietly turn into thirty page loads.
 */
export const WEB_SEARCH_MAX_USES = 5
export const WEB_FETCH_MAX_USES = 5

/** Per-page truncation, so one enormous article cannot crowd out the conversation. */
export const WEB_FETCH_MAX_CONTENT_TOKENS = 30_000

/**
 * Builds the server tools to bind for `model`.
 *
 * Web fetch is omitted rather than downgraded on older models. The pre-2026
 * fetch tool requires the `web-fetch-2025-09-10` beta header, which this app
 * does not set; binding it without the header produces a request that fails
 * every time it is used. An absent tool degrades honestly — the model searches
 * and says it cannot open the page — where a permanently-failing one would read
 * to the user as the feature being broken.
 */
export function buildServerTools(model: string): AnthropicServerTool[] {
  const dynamic = supportsDynamicFiltering(model)

  const tools: AnthropicServerTool[] = [
    {
      type: dynamic ? 'web_search_20260209' : 'web_search_20250305',
      name: 'web_search',
      max_uses: WEB_SEARCH_MAX_USES,
    },
  ]

  if (dynamic) {
    tools.push({
      type: 'web_fetch_20260209',
      name: 'web_fetch',
      max_uses: WEB_FETCH_MAX_USES,
      max_content_tokens: WEB_FETCH_MAX_CONTENT_TOKENS,
      // Gives the model quotable spans tied back to the source, so "according to
      // the docs" can be checked rather than taken on faith.
      citations: { enabled: true },
    })
  }

  return tools
}
