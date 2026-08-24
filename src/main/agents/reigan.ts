import { ChatAnthropic } from '@langchain/anthropic'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'
import { buildContextDigest } from '../context/digest'
import { getTimeTool, getSystemInfoTool, openAppTool } from './tools/systemTools'
import { createCalendarTools } from './tools/calendarTools'
import { createEmailTools } from './tools/emailTools'
import { searchFilesTool, listDirectoryTool, readFileTool } from './tools/fileTools'
import { getSettingsTool, updateSettingTool } from './tools/settingsTools'
import { getPerformanceSnapshotTool } from './tools/performanceTools'
import { buildAgentTools } from '../capabilities/agentTools'
import { googleAuth } from '../auth/googleAuth'
import { getDecodedSetting } from '../db/queries'
import type { PersonalityMode } from '../../shared/types'

let executor: AgentExecutor | null = null
let executorKey: string | null = null

function getApiKey(): string {
  return getDecodedSetting('anthropicApiKey') ?? process.env.ANTHROPIC_API_KEY ?? ''
}

function getPersonalityMode(): PersonalityMode {
  return getDecodedSetting('personalityMode') === 'unbridled' ? 'unbridled' : 'standard'
}

function getTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [
    // Generated from the capability registry — the tools declared in
    // main/capabilities/defs. `uiOnly` capabilities are excluded here by
    // construction, which is what keeps them out of the model's context.
    ...buildAgentTools(),

    // Legacy hand-written tools, not yet migrated to the registry. New tools
    // must be added as capabilities, not here.
    getTimeTool, getSystemInfoTool, openAppTool,
    searchFilesTool, listDirectoryTool, readFileTool,
    getSettingsTool, updateSettingTool,
    getPerformanceSnapshotTool,
  ]

  // Only exposed once the user has connected a Google account (Settings).
  // Registry capabilities handle this themselves via `requiresGoogle`.
  const googleClient = googleAuth.getClient()
  if (googleClient) {
    tools.push(...createCalendarTools(googleClient), ...createEmailTools(googleClient))
  }

  return tools
}

/**
 * The persona plus whatever has been learned about the user.
 *
 * The digest is user-derived text (fact bodies typed or paraphrased from the
 * user, project and job names pulled from stats) and is never escaped for
 * curly braces. It must never reach a ChatPromptTemplate string slot — see
 * buildPromptTemplate, which passes the composed result in as a SystemMessage
 * instance specifically so it is never parsed as a template variable.
 */
export function composeSystemPrompt(mode: PersonalityMode, digest: string): string {
  const persona = mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT
  return digest ? `${persona}\n\n${digest}` : persona
}

/**
 * Builds the chat prompt template for a given (already-composed) system
 * prompt.
 *
 * The system message is passed as a SystemMessage instance rather than a
 * `['system', systemPrompt]` tuple. ChatPromptTemplate.fromMessages
 * f-string-parses tuple/string entries for `{var}` placeholders — which is
 * why `['human', '{input}']` below resolves against the `input` run
 * variable. The composed system prompt is not static template prose: it
 * carries the context digest, which embeds arbitrary user-typed fact text
 * and project/job names verbatim and unescaped. A literal brace in any of
 * that — "Sprint {42} retro", a pasted snippet, a ticket reference — would
 * be read as an unfulfilled template variable and throw when the prompt is
 * formatted. A BaseMessage instance is passed through untouched by
 * fromMessages, so the digest can contain any text without risk.
 */
export function buildPromptTemplate(systemPrompt: string): ChatPromptTemplate {
  return ChatPromptTemplate.fromMessages([
    new SystemMessage(systemPrompt),
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ])
}

function buildExecutor(apiKey: string, mode: PersonalityMode, digest: string): AgentExecutor {
  const llm = new ChatAnthropic({
    apiKey,
    model: 'claude-sonnet-4-6',
    streaming: true,
    // claude-sonnet-4-6 isn't in @langchain/anthropic's model allowlist, so its
    // temperature/topP defaults (1 and -1) are sent unconditionally, which the API
    // rejects (top_p=-1 invalid, and temperature+top_p can't both be set). Explicit
    // temperature: null clears it (JSON.stringify drops undefined), leaving topP as
    // the only sampling param.
    temperature: null,
    topP: 1,
  })

  const tools = getTools()
  const systemPrompt = composeSystemPrompt(mode, digest)
  const prompt = buildPromptTemplate(systemPrompt)

  const agent = createToolCallingAgent({ llm, tools, prompt })
  return new AgentExecutor({ agent, tools, maxIterations: 5 })
}

export async function* streamResponse(
  input: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>
): AsyncGenerator<string> {
  const apiKey = getApiKey()
  if (!apiKey) {
    yield 'No API key configured. Please add your Anthropic API key in Settings (Ctrl+,).'
    return
  }

  const mode = getPersonalityMode()
  const { text: digest, hash } = buildContextDigest()
  const cacheKey = `${mode}:${hash}`

  if (!executor || executorKey !== cacheKey) {
    executor = buildExecutor(apiKey, mode, digest)
    executorKey = cacheKey
  }

  const chatHistory = history.flatMap(m =>
    m.role === 'user' ? [new HumanMessage(m.content)] : [new AIMessage(m.content)]
  )

  // AgentExecutor's final output is an object ({ output, ... }), so streamLog's
  // '/streamed_output_str/-' path (which only fires for string-typed outputs) never
  // matches. streamEvents v2 gives per-token deltas from the underlying chat model instead.
  const eventStream = executor.streamEvents(
    { input, chat_history: chatHistory },
    { version: 'v2' }
  )

  let yieldedAny = false

  for await (const event of eventStream) {
    if (event.event !== 'on_chat_model_stream') continue
    const content = event.data?.chunk?.content

    if (typeof content === 'string') {
      if (content) {
        yieldedAny = true
        yield content
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
          yieldedAny = true
          yield block.text
        }
      }
    }
  }

  if (!yieldedAny) {
    yield "I didn't have a response for that — try rephrasing."
  }
}

export function resetExecutor(): void {
  executor = null
  executorKey = null
}
