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
import { DEFAULT_MODEL_ID, DEFAULT_THINKING_BUDGET, resolveModel, resolveSampling } from '../../shared/models'
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

interface AgentConfig {
  mode: PersonalityMode
  model: string
  thinkingEnabled: boolean
  thinkingBudget: number
  temperature: number | null
}

let executor: AgentExecutor | null = null
/**
 * The whole config, serialised. This used to be the personality mode alone, so
 * changing the model, the thinking budget or the temperature left the previous
 * executor — and therefore the previous model — in place until a restart.
 */
let executorKey: string | null = null

/**
 * Settings arrive JSON-encoded from the renderer (settingsStore stringifies
 * every value), so a number is the text "4096" and an absent temperature is the
 * text "null". Number() would turn that last one into NaN.
 */
function readJsonSetting<T>(key: string, fallback: T): T {
  const raw = getDecodedSetting(key)
  if (raw === null || raw === '') return fallback
  try {
    const parsed = JSON.parse(raw)
    return (parsed as T) ?? fallback
  } catch {
    return fallback
  }
}

function getAgentConfig(): AgentConfig {
  const temperatureRaw = getDecodedSetting('temperature')
  let temperature: number | null = null
  if (temperatureRaw !== null && temperatureRaw !== '' && temperatureRaw !== 'null') {
    const parsed = Number(temperatureRaw)
    if (Number.isFinite(parsed)) temperature = parsed
  }

  return {
    mode: getPersonalityMode(),
    model: readJsonSetting('model', DEFAULT_MODEL_ID),
    thinkingEnabled: readJsonSetting('thinkingEnabled', false),
    thinkingBudget: readJsonSetting('thinkingBudget', DEFAULT_THINKING_BUDGET),
    temperature,
  }
}

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

function buildExecutor(apiKey: string, config: AgentConfig): AgentExecutor {
  const model = resolveModel(config.model)
  // The three rules that keep the request valid — temperature and top_p never
  // both set, the allowlist workaround for the default path, and thinking
  // fixing sampling — live in resolveSampling, which is tested. See
  // shared/models.ts.
  const sampling = resolveSampling({
    temperature: config.temperature,
    thinkingEnabled: config.thinkingEnabled,
    thinkingBudget: config.thinkingBudget,
    modelSupportsThinking: model.supportsThinking,
  })

  const llm = new ChatAnthropic({
    apiKey,
    model: model.id,
    streaming: true,
    ...sampling,
  })

  const tools = getTools()
  const systemPrompt = config.mode === 'unbridled' ? REIGAN_UNBRIDLED_SYSTEM_PROMPT : REIGAN_SYSTEM_PROMPT

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

  const config = getAgentConfig()
  const key = JSON.stringify(config)
  if (!executor || executorKey !== key) {
    executor = buildExecutor(apiKey, config)
    executorKey = key
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
  executorKey = null
}
