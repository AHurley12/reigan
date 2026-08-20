import { ChatAnthropic } from '@langchain/anthropic'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'
import { getTimeTool, getSystemInfoTool, openAppTool } from './tools/systemTools'
import { createCalendarTools } from './tools/calendarTools'
import { createEmailTools } from './tools/emailTools'
import { searchFilesTool, listDirectoryTool, readFileTool } from './tools/fileTools'
import { getSettingsTool, updateSettingTool } from './tools/settingsTools'
import { getPerformanceSnapshotTool } from './tools/performanceTools'
import { buildAgentTools } from '../capabilities/agentTools'
import { AGENT_MODEL, buildServerTools } from './serverTools'
import { googleAuth } from '../auth/googleAuth'
import { getDecodedSetting } from '../db/queries'
import type { PersonalityMode } from '../../shared/types'

let executor: AgentExecutor | null = null
let executorMode: PersonalityMode | null = null

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

function buildExecutor(apiKey: string, mode: PersonalityMode): AgentExecutor {
  const llm = new ChatAnthropic({
    apiKey,
    model: AGENT_MODEL,
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
  const systemPrompt = mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ])

  // Server tools are bound to the model but deliberately kept out of the
  // executor's dispatch list. Anthropic runs web search and web fetch on its own
  // infrastructure and returns their results inline, so there is no local
  // handler for the executor to route a call to. LangChain already agrees:
  // `server_tool_use` and `web_search_tool_result` blocks parse with an empty
  // `tool_call_chunks`, so they never surface as a pending call the executor
  // would try — and fail — to dispatch.
  const agent = createToolCallingAgent({
    llm,
    // `tools` is typed `StructuredToolInterface[] | ToolDefinition[]`, a union
    // that cannot express "local tools plus server-tool definitions". The cast
    // is safe because this array is only ever forwarded to
    // `ChatAnthropic.bindTools`, which passes anything matching a built-in tool
    // prefix straight through to the API untouched.
    tools: [...tools, ...buildServerTools(AGENT_MODEL)] as never,
    prompt,
  })

  // Raised from 5. A web-backed answer spends iterations before it can even
  // start: search, open one or two results, then reply — which left almost no
  // room for the local tools the model still needs in the same turn.
  return new AgentExecutor({ agent, tools, maxIterations: 12 })
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
  if (!executor || executorMode !== mode) {
    executor = buildExecutor(apiKey, mode)
    executorMode = mode
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
  executorMode = null
}
