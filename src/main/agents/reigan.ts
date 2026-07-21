import { ChatAnthropic } from '@langchain/anthropic'
import { AgentExecutor, createToolCallingAgent } from 'langchain/agents'
import type { DynamicStructuredTool } from '@langchain/core/tools'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import { HumanMessage, AIMessage } from '@langchain/core/messages'
import { REIGAN_SYSTEM_PROMPT } from './prompts'
import { createTaskTool, listTasksTool, updateTaskTool, completeTaskTool } from './tools/taskTools'
import { getTimeTool, getSystemInfoTool, openAppTool } from './tools/systemTools'
import { createCalendarTools } from './tools/calendarTools'
import { createEmailTools } from './tools/emailTools'
import { googleAuth } from '../auth/googleAuth'
import { getSetting } from '../db/queries'

let executor: AgentExecutor | null = null

function getApiKey(): string {
  return getSetting('anthropicApiKey') ?? process.env.ANTHROPIC_API_KEY ?? ''
}

function getTools(): DynamicStructuredTool[] {
  const tools: DynamicStructuredTool[] = [createTaskTool, listTasksTool, updateTaskTool, completeTaskTool, getTimeTool, getSystemInfoTool, openAppTool]

  // Only exposed once the user has connected a Google account (Settings).
  const googleClient = googleAuth.getClient()
  if (googleClient) {
    tools.push(...createCalendarTools(googleClient), ...createEmailTools(googleClient))
  }

  return tools
}

function buildExecutor(apiKey: string): AgentExecutor {
  const llm = new ChatAnthropic({
    apiKey,
    model: 'claude-sonnet-4-6',
    streaming: true,
  })

  const tools = getTools()

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

  let fullResponse = ''
  const stream = await executor.streamLog({ input, chat_history: chatHistory })

  for await (const chunk of stream) {
    for (const op of chunk.ops) {
      if (op.op === 'add' && op.path.includes('/streamed_output_str/-')) {
        const token = op.value as string
        fullResponse += token
        yield token
      }
    }
  }

  if (!fullResponse) {
    // Fallback: run without streaming
    const result = await executor.invoke({ input, chat_history: chatHistory })
    yield result.output
  }
}

export function resetExecutor(): void {
  executor = null
}
