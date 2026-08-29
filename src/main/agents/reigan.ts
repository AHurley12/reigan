import { ChatAnthropic } from '@langchain/anthropic'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool } from './tools/taskTools'
import { getTimeTool, getSystemInfoTool, openAppTool } from './tools/systemTools'
import { createCalendarTools } from './tools/calendarTools'
import { createEmailTools } from './tools/emailTools'
import { searchFilesTool, listDirectoryTool, readFileTool } from './tools/fileTools'
import { getSettingsTool, updateSettingTool } from './tools/settingsTools'
import { getPerformanceSnapshotTool } from './tools/performanceTools'
import { googleAuth } from '../auth/googleAuth'
import { getDecodedSetting, getAllDecodedSettings } from '../db/queries'
import { settingsPromptBlock } from '../../shared/settings/describe'
import { getCachedExecutor, setCachedExecutor } from './executorCache'
import type { PersonalityMode } from '../../shared/types'

function getApiKey(): string {
  return getDecodedSetting('anthropicApiKey') ?? process.env.ANTHROPIC_API_KEY ?? ''
}

function getPersonalityMode(): PersonalityMode {
  return getDecodedSetting('personalityMode') === 'unbridled' ? 'unbridled' : 'standard'
}

function getTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [
    createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, deleteTaskTool,
    getTimeTool, getSystemInfoTool, openAppTool,
    searchFilesTool, listDirectoryTool, readFileTool,
    getSettingsTool, updateSettingTool,
    getPerformanceSnapshotTool,
  ]

  // Only exposed once the user has connected a Google account (Settings).
  const googleClient = googleAuth.getClient()
  if (googleClient) {
    tools.push(...createCalendarTools(googleClient), ...createEmailTools(googleClient))
  }

  return tools
}

function buildExecutor(apiKey: string, mode: PersonalityMode): AgentExecutor {
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
  const basePrompt = mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT

  // Settings live in the prompt rather than behind get_settings alone: a tool
  // the model has to remember to call is one it will sometimes skip, and then
  // it answers about its own configuration from imagination. This block is
  // rebuilt whenever a setting changes (resetExecutor).
  //
  // settingsPromptBlock escapes braces for the f-string template; see its note.
  const settingsBlock = settingsPromptBlock(getAllDecodedSettings())

  const systemPrompt = `${basePrompt}

## Your current settings

These are live values read from the database, not examples. Answer questions
about your own configuration from this list rather than guessing, and do not
tell the user a setting is off when it is shown here as on. Change one with
update_setting; anything marked [default] has never been explicitly set.

${settingsBlock}`

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad'),
  ])

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
  let executor = getCachedExecutor(mode)
  if (!executor) {
    executor = buildExecutor(apiKey, mode)
    setCachedExecutor(mode, executor)
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

// Re-exported so existing callers (ipc/system.ts) keep their import path while
// the cache itself lives in a module the tools can reach without a cycle.
export { resetExecutor } from './executorCache'
