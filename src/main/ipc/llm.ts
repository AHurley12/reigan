import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { streamResponse } from '../agents/reigan'
import { saveMessage, createConversation, getSetting, getDecodedSetting } from '../db/queries'
import { voiceManager } from '../voice/voiceManager'

let activeConversationId: string | null = null

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
    const hasKey = !!getDecodedSetting('anthropicApiKey')

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
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`
      mainWindow.webContents.send(IPC.LLM_STREAM, { token: errMsg, done: true, conversationId: activeConversationId })
      return { conversationId: activeConversationId }
    }

    mainWindow.webContents.send(IPC.LLM_STREAM, { token: '', done: true, conversationId: activeConversationId })
    saveMessage({ conversationId: activeConversationId, role: 'assistant', content: fullResponse })

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
      voiceManager.speak(fullResponse, { elevenLabsApiKey, voiceId, stability, similarityBoost }).catch(() => {})
    }

    return { conversationId: activeConversationId }
  })
}
