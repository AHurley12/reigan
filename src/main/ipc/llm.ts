import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { streamResponse } from '../agents/reigan'
import { saveMessage, createConversation, getSetting, getDecodedSetting } from '../db/queries'
import { voiceManager } from '../voice/voiceManager'
import { recordAppError } from '../errors/errorLog'
import { maybeDistill } from '../context/distill'

let activeConversationId: string | null = null

/**
 * The key the agent will actually use.
 *
 * `reigan.ts` reads the setting and falls back to `ANTHROPIC_API_KEY`, so
 * anything here that consults only the setting disagrees with the module doing
 * the work. That disagreement silently disabled the context layer for anyone
 * running from the environment: the distiller received `''` and bailed with no
 * record, so chat behaved normally and learning never started.
 */
function getAnthropicKey(): string {
  return getDecodedSetting('anthropicApiKey') ?? process.env.ANTHROPIC_API_KEY ?? ''
}

export function registerLLMHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.LLM_SEND, async (_event, payload: {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
    conversationId?: string
  }) => {
    const { message, history, conversationId } = payload

    // Ensure we have a conversation
    if (!activeConversationId) {
      activeConversationId = conversationId ?? createConversation()
    }

    // Save user message
    saveMessage({ conversationId: activeConversationId, role: 'user', content: message })

    let fullResponse = ''
    const hasKey = !!getAnthropicKey()

    if (!hasKey) {
      const placeholder = 'REIGAN is not yet connected. Add your Anthropic API key in Settings (Ctrl+,).'
      mainWindow.webContents.send(IPC.LLM_STREAM, { token: placeholder, done: true, conversationId: activeConversationId })
      saveMessage({ conversationId: activeConversationId, role: 'assistant', content: placeholder })
      return { conversationId: activeConversationId }
    }

    try {
      for await (const token of streamResponse(message, history)) {
        fullResponse += token
        mainWindow.webContents.send(IPC.LLM_STREAM, { token, done: false, conversationId: activeConversationId })
      }
    } catch (err) {
      console.error('[REIGAN] streamResponse failed:', err)
      // The user sees this once, inline in the transcript, and then it scrolls
      // away. A console line is not a record on a packaged build where nobody
      // has a terminal open.
      recordAppError({
        source: 'llm',
        operation: 'streamResponse',
        error: err,
        context: { conversationId: activeConversationId, historyLength: history.length },
      })
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`
      mainWindow.webContents.send(IPC.LLM_STREAM, { token: errMsg, done: true, conversationId: activeConversationId })
      return { conversationId: activeConversationId }
    }

    mainWindow.webContents.send(IPC.LLM_STREAM, { token: '', done: true, conversationId: activeConversationId })
    saveMessage({ conversationId: activeConversationId, role: 'assistant', content: fullResponse })

    // Fire-and-forget. Learning must never delay or break a reply, so this is
    // deliberately not awaited — see maybeDistill's own error handling.
    maybeDistill(
      activeConversationId,
      message + fullResponse,
      [...history, { role: 'user', content: message }, { role: 'assistant', content: fullResponse }],
      getAnthropicKey(),
    )

    const wasVoiceInput = voiceManager.consumeExpectSpokenReply()
    const voiceResponseMode = getDecodedSetting('voiceResponseMode') ?? 'conversational'
    const shouldSpeak = voiceResponseMode === 'always' || (voiceResponseMode === 'conversational' && wasVoiceInput)

    if (shouldSpeak) {
      const elevenLabsApiKey = getDecodedSetting('elevenLabsApiKey') ?? ''
      const voiceId = getDecodedSetting('voiceId') ?? undefined
      const stabilityRaw = Number(getSetting('ttsStability'))
      const similarityRaw = Number(getSetting('ttsSimilarity'))
      const stability = Number.isFinite(stabilityRaw) ? stabilityRaw : 0.5
      const similarityBoost = Number.isFinite(similarityRaw) ? similarityRaw : 0.75
      // Not `.catch(() => {})`. Speech failing while the reply is already on
      // screen is the definition of a failure with no symptom: the answer is
      // there, it simply never spoke, and the user is left thinking the voice
      // feature is broken with nothing to point at. Still swallowed as far as
      // control flow goes — a dead TTS key must not break the reply — but no
      // longer unrecorded.
      voiceManager
        .speak(fullResponse, { elevenLabsApiKey, voiceId, stability, similarityBoost })
        .catch((err) => {
          recordAppError({
            source: 'voice',
            operation: 'speak',
            error: err,
            severity: 'warning',
            context: {
              conversationId: activeConversationId,
              hasKey: !!elevenLabsApiKey,
              voiceId: voiceId ?? null,
              consequence: 'reply was shown but not spoken',
            },
          })
        })
    }

    return { conversationId: activeConversationId }
  })
}
