import { ipcMain, BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { streamResponse } from '../agents/reigan'
import { saveMessage, createConversation, getSetting } from '../db/queries'

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
    const hasKey = !!getSetting('anthropicApiKey')

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
      const errMsg = `Error: ${err instanceof Error ? err.message : String(err)}`
      mainWindow.webContents.send(IPC.LLM_STREAM, { token: errMsg, done: true, conversationId: activeConversationId })
      return { conversationId: activeConversationId }
    }

    mainWindow.webContents.send(IPC.LLM_STREAM, { token: '', done: true, conversationId: activeConversationId })
    saveMessage({ conversationId: activeConversationId, role: 'assistant', content: fullResponse })

    return { conversationId: activeConversationId }
  })
}
