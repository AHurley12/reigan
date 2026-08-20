import { describe, it, expect } from 'vitest'
import { ChatAnthropic } from '@langchain/anthropic'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import {
  AGENT_MODEL,
  buildServerTools,
  supportsDynamicFiltering,
  WEB_SEARCH_MAX_USES,
  WEB_FETCH_MAX_USES,
} from './serverTools'

/**
 * These tools are never executed locally, so there is no handler to unit test.
 * What can go wrong is the *shape*: a tool `type` the API doesn't recognise, a
 * variant newer than the model, or a prefix LangChain declines to forward. Each
 * of those fails only on a live billed request, which is exactly the class of
 * mistake worth pinning down here.
 */
describe('server tools', () => {
  it('binds both web tools on the model the agent actually runs', () => {
    const tools = buildServerTools(AGENT_MODEL)

    expect(tools.map((t) => t.name)).toEqual(['web_search', 'web_fetch'])
  })

  it('uses the dynamic-filtering variants on a supporting model', () => {
    const tools = buildServerTools('claude-sonnet-4-6')

    expect(tools.map((t) => t.type)).toEqual(['web_search_20260209', 'web_fetch_20260209'])
  })

  /**
   * The names are fixed by the API, not by us — a server tool is matched by
   * `name`, so a rename here silently stops the tool from resolving.
   */
  it('uses the API-mandated tool names', () => {
    const tools = buildServerTools(AGENT_MODEL)

    expect(tools.find((t) => t.name === 'web_search')).toBeDefined()
    expect(tools.find((t) => t.name === 'web_fetch')).toBeDefined()
  })

  /**
   * The load-bearing assertion. ChatAnthropic forwards a tool definition
   * untouched only when its `type` starts with one of a fixed list of built-in
   * prefixes; anything else is treated as a custom tool and rejected for having
   * no `input_schema`. Pinning the prefixes means a future edit to the `type`
   * strings fails here rather than at runtime on the user's machine.
   */
  it('keeps types on the prefixes LangChain forwards verbatim', () => {
    const tools = buildServerTools(AGENT_MODEL)

    expect(tools.find((t) => t.name === 'web_search')!.type).toMatch(/^web_search_/)
    expect(tools.find((t) => t.name === 'web_fetch')!.type).toMatch(/^web_fetch_/)
  })

  it('caps how far each tool can run in one turn', () => {
    const tools = buildServerTools(AGENT_MODEL)

    expect(tools.find((t) => t.name === 'web_search')!.max_uses).toBe(WEB_SEARCH_MAX_USES)
    expect(tools.find((t) => t.name === 'web_fetch')!.max_uses).toBe(WEB_FETCH_MAX_USES)
  })

  it('never sends a schema — a server tool that carries one is a custom tool', () => {
    for (const tool of buildServerTools(AGENT_MODEL)) {
      expect(tool).not.toHaveProperty('input_schema')
    }
  })

  describe('on a model without the 2026 web tools', () => {
    const OLD_MODEL = 'claude-haiku-4-5'

    it('falls back to the basic search variant', () => {
      const search = buildServerTools(OLD_MODEL).find((t) => t.name === 'web_search')

      expect(search!.type).toBe('web_search_20250305')
    })

    /**
     * Omitted, not downgraded: the older fetch tool needs a beta header this app
     * does not send, so binding it would produce a tool that fails on every use.
     */
    it('omits web fetch rather than binding one that always fails', () => {
      const tools = buildServerTools(OLD_MODEL)

      expect(tools.find((t) => t.name === 'web_fetch')).toBeUndefined()
    })
  })

  /**
   * Guards the reason the model constant lives in this module: moving the agent
   * to a model outside the set silently costs the user web fetch entirely.
   */
  it('runs on a model that supports the full web tool set', () => {
    expect(supportsDynamicFiltering(AGENT_MODEL)).toBe(true)
  })

  /**
   * Everything above tests what we send. This tests what LangChain does with
   * it, which is the part actually holding the feature up — and the part we do
   * not control. `formatStructuredToolToAnthropic` is the exact function the
   * agent's tool binding runs through, so putting a real local tool and the
   * server tools through it together reproduces the production call shape
   * without a request leaving the machine. If a future @langchain/anthropic
   * drops the built-in prefix passthrough, this fails at `npm test` rather than
   * as a 400 in the user's chat window.
   */
  it('survives the binding LangChain actually performs', () => {
    const llm = new ChatAnthropic({ apiKey: 'sk-ant-not-a-real-key', model: AGENT_MODEL })
    const local = new DynamicStructuredTool({
      name: 'tasks_list',
      description: 'Stands in for a capability-generated tool.',
      schema: z.object({}),
      func: async () => 'ok',
    })

    // Cast: the formatter is internal to ChatAnthropic, but it is the seam that
    // decides whether a server tool reaches the API intact, so it is the honest
    // thing to assert against.
    const formatted = (
      llm as unknown as {
        formatStructuredToolToAnthropic: (tools: unknown[]) => Array<Record<string, unknown>>
      }
    ).formatStructuredToolToAnthropic([local, ...buildServerTools(AGENT_MODEL)])

    // The local tool is converted into a schema-carrying custom tool...
    expect(formatted[0]).toHaveProperty('input_schema')

    // ...while the server tools come out the other side byte-identical, with no
    // schema invented for them.
    expect(formatted.slice(1)).toEqual(buildServerTools(AGENT_MODEL))
  })
})
