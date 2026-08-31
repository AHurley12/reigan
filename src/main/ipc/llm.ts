import { ipcMain, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '../../shared/types'
import type { ChatAttachmentInput, ChatStreamEvent, ToolCallEvent, TurnUsage } from '../../shared/types'
import { saveAttachments } from '../files/attachmentStore'
import { deriveConversationTitle } from '../../shared/conversationTitle'
import { streamResponse } from '../agents/reigan'
import { saveMessage, saveToolCalls, createConversation, deleteMessagesFrom, getSetting, getDecodedSetting } from '../db/queries'
import { voiceManager } from '../voice/voiceManager'
import { recordAppError } from '../errors/errorLog'
import { describeToolInputFailure } from '../errors/toolInput'
import { setApprovalConversation } from '../capabilities/approval'

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
    /** Regenerate / edit-and-resend: drop this turn and everything after it first. */
    truncateFromTimestamp?: number
    attachments?: ChatAttachmentInput[]
  }) => {
    const attachments = payload.attachments ?? []
    const { message, history, conversationId } = payload
    const requestId = payload.requestId ?? randomUUID()

    // Resolved per call. This used to be a module-level `activeConversationId`
    // that was assigned once and never reset, so the caller's conversationId was
    // ignored for the rest of the process's life: clearing the chat gave the
    // renderer a fresh transcript while main kept appending to the very first
    // conversation row it had ever created.
    //
    // A new conversation is titled from its opening message, which is also the
    // only place a title is ever set automatically.
    const convId = conversationId ?? createConversation(deriveConversationTitle(message))

    /** Every frame goes out through here, so the destroyed-window guard exists once. */
    const emit = (event: ChatStreamEvent): void => {
      if (mainWindow.isDestroyed()) return
      mainWindow.webContents.send(IPC.LLM_STREAM, { requestId, conversationId: convId, event })
    }

    // Scopes any `approvalPolicy: 'session'` grant to this conversation. Called
    // per message rather than only on creation, so a grant given in an earlier
    // conversation cannot carry into a later one; it no-ops when the id is
    // unchanged. Keyed to `convId` — the module-level `activeConversationId`
    // this once used is gone, along with the bug that made it stick.
    setApprovalConversation(convId)

    // Truncation happens here rather than through a capability of its own.
    // A `write` capability would raise the approval dialog on every single
    // regenerate — `requireApprovalForAllCapabilities` defaults on — and asking
    // permission to redo the thing the user just clicked Redo on is noise.
    // Doing it inside the send also keeps it atomic with the resend: there is no
    // window where the old turn is gone and no new one has started.
    if (conversationId && payload.truncateFromTimestamp !== undefined) {
      deleteMessagesFrom(conversationId, payload.truncateFromTimestamp)
    }

    // Save user message. Its id is needed immediately: attachments hang off it,
    // and the FK means they cannot be written before it exists.
    const userMessageId = saveMessage({ conversationId: convId, role: 'user', content: message })
    if (attachments.length > 0) saveAttachments(userMessageId, attachments)

    let fullResponse = ''
    let turnUsage: TurnUsage | undefined
    // Merged by run id: a tool arrives as a start (name, args) and later an end
    // (result, duration), and the stored row wants both halves.
    const toolCalls = new Map<string, ToolCallEvent>()
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
      // Only this turn's attachments are sent. Replaying every historical image
      // on every subsequent turn would multiply cost silently and fill the
      // context window with files the question is no longer about.
      for await (const event of streamResponse(message, history, controller.signal, attachments)) {
        if (event.kind === 'token') fullResponse += event.text
        if (event.kind === 'usage') turnUsage = event.usage
        if (event.kind === 'tool') {
          const previous = toolCalls.get(event.call.id)
          toolCalls.set(event.call.id, {
            ...event.call,
            // The end event carries no args and the start carries no result.
            argsPreview: event.call.argsPreview ?? previous?.argsPreview ?? null,
            resultPreview: event.call.resultPreview ?? previous?.resultPreview ?? null,
          })
        }
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
      // A tool-schema rejection is recorded under the tool that was rejected.
      // LangChain's message names no tool, so left as-is every such failure
      // fingerprinted onto one anonymous row — see errors/toolInput.ts.
      const toolFailure = describeToolInputFailure(err)
      recordAppError({
        source: 'llm',
        operation: toolFailure ? 'toolInput' : 'streamResponse',
        error: toolFailure ? toolFailure.message : err,
        subject: toolFailure?.toolName,
        context: {
          conversationId: convId,
          historyLength: history.length,
          ...(toolFailure ? { rejectedInput: toolFailure.input } : {}),
        },
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
    const assistantMessageId = saveMessage({
      conversationId: convId,
      role: 'assistant',
      content: fullResponse,
      usage: turnUsage,
    })
    saveToolCalls(assistantMessageId, [...toolCalls.values()].sort((a, b) => a.seq - b.seq))

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
