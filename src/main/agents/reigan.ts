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
import { googleAuth } from '../auth/googleAuth'
import { getDecodedSetting } from '../db/queries'
import { classify } from '../../shared/attachmentPolicy'
import type { ChatAttachmentInput, ChatStreamEvent, PersonalityMode } from '../../shared/types'

/**
 * Builds the human turn, with attachments as content blocks alongside the text.
 *
 * The block shapes are the ones @langchain/anthropic translates: `image_url`
 * with a data URL becomes an Anthropic `image` block, and a `file` block with a
 * base64 source and a PDF mime type becomes a `document` block. Anything the
 * policy does not classify is dropped rather than sent in a shape the converter
 * would throw on.
 */
function buildTurnMessage(text: string, attachments: ChatAttachmentInput[]): HumanMessage {
  if (attachments.length === 0) return new HumanMessage(text)

  const blocks: Record<string, unknown>[] = []

  for (const attachment of attachments) {
    const kind = classify(attachment.mimeType)
    if (kind === 'image') {
      blocks.push({
        type: 'image_url',
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.data}` },
      })
    } else if (kind === 'document') {
      blocks.push({
        type: 'file',
        source_type: 'base64',
        mime_type: attachment.mimeType,
        data: attachment.data,
      })
    }
  }

  // Text last: the question should read as being about the things above it.
  blocks.push({ type: 'text', text })

  return new HumanMessage({ content: blocks as never })
}

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
  const systemPrompt = mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT

  // `input` is a MessagesPlaceholder rather than the ['human', '{input}'] string
  // template it used to be. A string template runs its value through f-string
  // formatting, which stringifies an array of content blocks into JSON — so
  // images and PDFs arrived at the model as text describing an image.
  //
  // For a text-only turn the two forms are byte-identical (verified: same
  // rendered messages, same declared inputVariables), so nothing about the
  // existing path changes.
  const prompt = ChatPromptTemplate.fromMessages([
    ['system', systemPrompt],
    new MessagesPlaceholder('chat_history'),
    new MessagesPlaceholder('input'),
    new MessagesPlaceholder('agent_scratchpad'),
  ])

  const agent = createToolCallingAgent({ llm, tools, prompt })
  return new AgentExecutor({ agent, tools, maxIterations: 5 })
}

/**
 * Yields `ChatStreamEvent`s rather than bare strings: the caller has to be able
 * to tell a token apart from a terminal condition, and later phases put usage
 * and tool activity on this same generator without changing its shape again.
 *
 * `signal` is threaded into the runnable config so a stop reaches the model
 * connection itself, not just this loop — otherwise the request keeps running
 * and keeps being billed after the user has stopped watching.
 */
export async function* streamResponse(
  input: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
  attachments: ChatAttachmentInput[] = []
): AsyncGenerator<ChatStreamEvent> {
  const apiKey = getApiKey()
  if (!apiKey) {
    yield { kind: 'token', text: 'No API key configured. Please add your Anthropic API key in Settings (Ctrl+,).' }
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
    { input: [buildTurnMessage(input, attachments)], chat_history: chatHistory },
    { version: 'v2', signal }
  )

  let yieldedAny = false

  for await (const event of eventStream) {
    if (event.event !== 'on_chat_model_stream') continue
    const content = event.data?.chunk?.content

    if (typeof content === 'string') {
      if (content) {
        yieldedAny = true
        yield { kind: 'token', text: content }
      }
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text) {
          yieldedAny = true
          yield { kind: 'token', text: block.text }
        }
      }
    }
  }

  // A stop is not an empty answer. Without this check the "try rephrasing" line
  // would be appended to whatever the user had already stopped, which reads as
  // the assistant talking back after being interrupted.
  if (!yieldedAny && !signal?.aborted) {
    yield { kind: 'token', text: "I didn't have a response for that — try rephrasing." }
  }
}

export function resetExecutor(): void {
  executor = null
  executorMode = null
}
