import { ChatAnthropic } from '@langchain/anthropic'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { REIGAN_SYSTEM_PROMPT } from './prompts'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool } from './tools/taskTools'
import { getTimeTool, getSystemInfoTool, openAppTool } from './tools/systemTools'
import { getSetting } from '../db/queries'

const tools = [createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, getTimeTool, getSystemInfoTool, openAppTool]

let executor: AgentExecutor | null = null

function getApiKey(): string {
  return getSetting('anthropicApiKey') ?? process.env.ANTHROPIC_API_KEY ?? ''
}

function buildExecutor(apiKey: string): AgentExecutor {
  const llm = new ChatAnthropic({
    apiKey,
    model: 'claude-sonnet-4-6',
    streaming: true,
  })

  const prompt = ChatPromptTemplate.fromMessages([
    ['system', REIGAN_SYSTEM_PROMPT],
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

  if (!executor) {
    executor = buildExecutor(apiKey)
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
}
