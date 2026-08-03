import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FileSearchParams } from '../shared/types'

const api = {
  // LLM
  sendMessage: (payload: { message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; conversationId?: string }) =>
    ipcRenderer.invoke(IPC.LLM_SEND, payload),
  onStream: (callback: (data: { token: string; done: boolean; conversationId: string }) => void) => {
    const handler = (_: unknown, data: { token: string; done: boolean; conversationId: string }) => callback(data)
    ipcRenderer.on(IPC.LLM_STREAM, handler)
    return () => ipcRenderer.removeListener(IPC.LLM_STREAM, handler)
  },

  // Tasks
  createTask: (params: object) => ipcRenderer.invoke(IPC.TASK_CREATE, params),
  listTasks: (params?: object) => ipcRenderer.invoke(IPC.TASK_LIST, params),
  updateTask: (id: string, updates: object) => ipcRenderer.invoke(IPC.TASK_UPDATE, { id, updates }),
  deleteTask: (id: string) => ipcRenderer.invoke(IPC.TASK_DELETE, id),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke(IPC.SETTINGS_GET, key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke(IPC.SETTINGS_SET, key, value),
  getAllSettings: () => ipcRenderer.invoke(IPC.SETTINGS_LOAD_ALL),

  // System
  getSystemInfo: () => ipcRenderer.invoke(IPC.SYSTEM_INFO),

  // Voice
  voice: {
    startListening: () => ipcRenderer.invoke(IPC.VOICE_START),
    stopListening: () => ipcRenderer.invoke(IPC.VOICE_STOP),
    sendAudioChunk: (buffer: ArrayBuffer) => ipcRenderer.send(IPC.VOICE_AUDIO_CHUNK, buffer),
    sendAmplitude: (rms: number) => ipcRenderer.send(IPC.VOICE_AMPLITUDE, rms),
    onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => {
      const handler = (_: unknown, data: { text: string; isFinal: boolean }) => callback(data)
      ipcRenderer.on(IPC.VOICE_TRANSCRIPT, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_TRANSCRIPT, handler)
    },
    onAudioPlayback: (callback: (audioBuffer: ArrayBuffer) => void) => {
      const handler = (_: unknown, audioBuffer: ArrayBuffer) => callback(audioBuffer)
      ipcRenderer.on(IPC.VOICE_AUDIO_PLAYBACK, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_AUDIO_PLAYBACK, handler)
    },
    onStateChange: (callback: (state: string) => void) => {
      const handler = (_: unknown, state: string) => callback(state)
      ipcRenderer.on(IPC.VOICE_STATE_CHANGE, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_STATE_CHANGE, handler)
    },
    onOrbAudio: (callback: (data: { amplitude: number; bass: number; mid: number; high: number }) => void) => {
      const handler = (_: unknown, data: { amplitude: number; bass: number; mid: number; high: number }) => callback(data)
      ipcRenderer.on(IPC.VOICE_ORB_AUDIO, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_ORB_AUDIO, handler)
    },
    onError: (callback: (message: string) => void) => {
      const handler = (_: unknown, message: string) => callback(message)
      ipcRenderer.on(IPC.VOICE_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_ERROR, handler)
    },
  },

  // Google account
  google: {
    getStatus: () => ipcRenderer.invoke(IPC.GOOGLE_STATUS),
    connect: () => ipcRenderer.invoke(IPC.GOOGLE_CONNECT),
    disconnect: () => ipcRenderer.invoke(IPC.GOOGLE_DISCONNECT),
  },

  // Calendar
  calendar: {
    listEvents: (startDate: string, endDate: string) =>
      ipcRenderer.invoke(IPC.CALENDAR_LIST_EVENTS, { startDate, endDate }),
  },

  // Mail
  mail: {
    listThreads: (params: { category: string; unreadOnly?: boolean }) =>
      ipcRenderer.invoke(IPC.MAIL_LIST_THREADS, params),
    categoryCounts: () => ipcRenderer.invoke(IPC.MAIL_CATEGORY_COUNTS),
    getThread: (threadId: string) => ipcRenderer.invoke(IPC.MAIL_GET_THREAD, threadId),
    reply: (params: { threadId: string; to: string; subject: string; body: string }) =>
      ipcRenderer.invoke(IPC.MAIL_REPLY, params),
    archive: (threadId: string) => ipcRenderer.invoke(IPC.MAIL_ARCHIVE, threadId),
    setRead: (threadId: string, read: boolean) => ipcRenderer.invoke(IPC.MAIL_SET_READ, { threadId, read }),
  },

  // Files (read-only browse/search)
  files: {
    listDir: (dirPath?: string) => ipcRenderer.invoke(IPC.FILES_LIST_DIR, dirPath),
    search: (params: FileSearchParams) => ipcRenderer.invoke(IPC.FILES_SEARCH, params),
    indexStatus: () => ipcRenderer.invoke(IPC.FILES_INDEX_STATUS),
    reindex: () => ipcRenderer.invoke(IPC.FILES_REINDEX),
    readContent: (filePath: string) => ipcRenderer.invoke(IPC.FILES_READ_CONTENT, filePath),
    open: (filePath: string) => ipcRenderer.invoke(IPC.FILES_OPEN, filePath),
    reveal: (filePath: string) => ipcRenderer.invoke(IPC.FILES_REVEAL, filePath),
  },

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('reigan', api)
