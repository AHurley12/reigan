import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/types'
import type { ChatStreamEvent } from '../../shared/types'
import { streamResponse } from '../agents/reigan'
import { saveMessage, createConversation, getSetting, getDecodedSetting } from '../db/queries'
import { voiceManager } from '../voice/voiceManager'
import { recordAppError } from '../errors/errorLog'

let activeConversationId: string | null = null

/**
 * In-flight generations, so the UI can stop one. Same shape as the capability
 * layer's map in capabilities/ipc.ts — keyed by a caller-supplied id, and always
 * deleted in a `finally` so a throw cannot leak an entry.
 */
const inFlight = new Map<string, AbortController>()

export function registerLLMHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC.LLM_SEND, async (_event, payload: {
    message: string
    history: Array<{ role: 'user' | 'assistant'; content: string }>
    conversationId?: string
    requestId?: string
  }) => {
    const { message, history, conversationId } = payload
    const requestId = payload.requestId ?? randomUUID()

    // Ensure we have a conversation
    if (!activeConversationId) {
      activeConversationId = conversationId ?? createConversation()
    }
    const convId = activeConversationId

    /** Every frame goes out through here, so the destroyed-window guard exists once. */
    const emit = (event: ChatStreamEvent): void => {
      if (mainWindow.isDestroyed()) return
      mainWindow.webContents.send(IPC.LLM_STREAM, { requestId, conversationId: convId, event })
    }

    // Save user message
    saveMessage({ conversationId: convId, role: 'user', content: message })

    let fullResponse = ''
    const hasKey = !!getDecodedSetting('anthropicApiKey')

    if (!hasKey) {
      const placeholder = 'REIGAN is not yet connected. Add your Anthropic API key in Settings (Ctrl+,).'
      emit({ kind: 'token', text: placeholder })
      emit({ kind: 'done', reason: 'complete' })
      saveMessage({ conversationId: convId, role: 'assistant', content: placeholder })
      return { conversationId: convId, requestId }
    }

    const controller = new AbortController()
    inFlight.set(requestId, controller)

    // Consumed unconditionally, even on a stop or a failure. Leaving the flag
    // set would make the *next* typed reply speak out of nowhere.
    const wasVoiceInput = voiceManager.consumeExpectSpokenReply()

    try {
      for await (const event of streamResponse(message, history, controller.signal)) {
        if (event.kind === 'token') fullResponse += event.text
        emit(event)
      }
    } catch (err) {
      // An abort surfaces here as a thrown AbortError. It is a user action, not
      // a fault: it must not be logged as an app error or shown as a failure.
      if (controller.signal.aborted) {
        persistPartial(convId, fullResponse)
        emit({ kind: 'done', reason: 'aborted' })
        return { conversationId: convId, requestId }
      }

      console.error('[REIGAN] streamResponse failed:', err)
      // The user sees this once, inline in the transcript, and then it scrolls
      // away. A console line is not a record on a packaged build where nobody
      // has a terminal open.
      recordAppError({
        source: 'llm',
        operation: 'streamResponse',
        error: err,
        context: { conversationId: convId, historyLength: history.length },
      })
      // Sent as a terminal reason rather than as a token. An error appended to
      // the transcript as text is indistinguishable from model output, gets
      // persisted as if the assistant said it, and cannot be retried.
      persistPartial(convId, fullResponse)
      emit({
        kind: 'done',
        reason: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
      return { conversationId: convId, requestId }
    } finally {
      inFlight.delete(requestId)
    }

    // A stop can land between the last token and here, in which case the catch
    // above never ran because the generator finished cleanly first.
    if (controller.signal.aborted) {
      persistPartial(convId, fullResponse)
      emit({ kind: 'done', reason: 'aborted' })
      return { conversationId: convId, requestId }
    }

    emit({ kind: 'done', reason: 'complete' })
    saveMessage({ conversationId: convId, role: 'assistant', content: fullResponse })

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
              conversationId: convId,
              hasKey: !!elevenLabsApiKey,
              voiceId: voiceId ?? null,
              consequence: 'reply was shown but not spoken',
            },
          })
        })
    }

    return { conversationId: convId, requestId }
  })

  ipcMain.handle(IPC.LLM_ABORT, (_event, requestId: string) => {
    const controller = inFlight.get(requestId)
    if (!controller) return false
    controller.abort()
    return true
  })
}

/**
 * A stopped or failed generation still produced tokens the user watched arrive.
 * Dropping them would leave the transcript and the database disagreeing the
 * next time the conversation is opened.
 */
function persistPartial(conversationId: string, text: string): void {
  if (!text) return
  saveMessage({ conversationId, role: 'assistant', content: text })
}
