import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type FileSearchParams, type JobNotification } from '../shared/types'
import { authBridge } from './authBridge'

// Main reads the persisted theme synchronously (better-sqlite3) before creating
// the window and passes it here via additionalArguments, so we can stamp
// data-theme before the renderer's own scripts run — zero flash of the wrong
// theme, since applyTokens() in ThemeProvider resolves the same id.
const THEME_ARG_PREFIX = '--initial-theme='
const themeArg = process.argv.find((arg) => arg.startsWith(THEME_ARG_PREFIX))
const initialThemeId = themeArg ? themeArg.slice(THEME_ARG_PREFIX.length) : 'shingan'

// Preload can run before the document exists. Stamping unguarded throws here
// and takes the whole contextBridge exposure below down with it.
function stampInitialTheme(): void {
  document.documentElement?.setAttribute('data-theme', initialThemeId)
}
try {
  if (document.documentElement) stampInitialTheme()
  else document.addEventListener('DOMContentLoaded', stampInitialTheme, { once: true })
} catch {
  // Never let theming take down the contextBridge exposure below.
}

const api = {
  initialThemeId,

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
  getSecretPreviews: () => ipcRenderer.invoke(IPC.SETTINGS_SECRET_PREVIEWS),

  // System
  getSystemInfo: () => ipcRenderer.invoke(IPC.SYSTEM_INFO),

  // Voice
  voice: {
    startListening: () => ipcRenderer.invoke(IPC.VOICE_START),
    stopListening: () => ipcRenderer.invoke(IPC.VOICE_STOP),
    stopSpeaking: () => ipcRenderer.invoke(IPC.VOICE_STOP_SPEAKING),
    sendAudioChunk: (buffer: ArrayBuffer) => ipcRenderer.send(IPC.VOICE_AUDIO_CHUNK, buffer),
    sendAmplitude: (rms: number) => ipcRenderer.send(IPC.VOICE_AMPLITUDE, rms),
    onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => {
      const handler = (_: unknown, data: { text: string; isFinal: boolean }) => callback(data)
      ipcRenderer.on(IPC.VOICE_TRANSCRIPT, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_TRANSCRIPT, handler)
    },
    onAudioPlayback: (callback: (audioBuffer: Uint8Array) => void) => {
      const handler = (_: unknown, audioBuffer: Uint8Array) => callback(audioBuffer)
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

  // Avatar
  avatar: {
    saveModel: (data: ArrayBuffer) => ipcRenderer.invoke(IPC.AVATAR_SAVE_MODEL, data),
    loadModel: () => ipcRenderer.invoke(IPC.AVATAR_LOAD_MODEL),
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

  // Performance
  perf: {
    staticInfo: () => ipcRenderer.invoke(IPC.PERF_STATIC_INFO),
    start: () => ipcRenderer.invoke(IPC.PERF_START),
    stop: () => ipcRenderer.invoke(IPC.PERF_STOP),
    onSample: (callback: (sample: import('../shared/types').PerfSample) => void) => {
      const handler = (_: unknown, sample: import('../shared/types').PerfSample) => callback(sample)
      ipcRenderer.on(IPC.PERF_SAMPLE, handler)
      return () => ipcRenderer.removeListener(IPC.PERF_SAMPLE, handler)
    },
  },

  // Voice authentication (lock screen). See preload/authBridge.ts.
  auth: authBridge,

  // Capability registry — the generic surface for everything declared in
  // main/capabilities. Deliberately *not* one bridge method per operation: a
  // capability is reachable the moment it is registered, with no preload edit.
  capabilities: {
    invoke: <T = unknown>(id: string, args?: unknown, invocationId?: string) =>
      ipcRenderer.invoke('capability:invoke', { id, args, invocationId }) as Promise<{
        ok: boolean
        result?: T
        error?: string
        errorCode?: string
        awaitingApprovalId?: string
      }>,
    cancel: (invocationId: string) => ipcRenderer.invoke('capability:cancel', invocationId),
    list: () => ipcRenderer.invoke('capability:list'),
    onProgress: (
      callback: (data: { invocationId: string; done: number; total: number; label?: string }) => void
    ) => {
      const handler = (_: unknown, data: { invocationId: string; done: number; total: number; label?: string }) =>
        callback(data)
      ipcRenderer.on('capability:progress', handler)
      return () => ipcRenderer.removeListener('capability:progress', handler)
    },
  },

  // Jobs — every non-success outcome the scheduler produces. Main has been
  // sending on this channel since the job engine landed, but nothing bridged it,
  // so in-app job alerts (including "automation disabled") were dropped on the
  // floor and only the urgent ones ever surfaced, as OS toasts.
  jobs: {
    onNotification: (callback: (event: JobNotification) => void) => {
      const handler = (_: unknown, event: JobNotification) => callback(event)
      ipcRenderer.on(IPC.JOBS_NOTIFICATION, handler)
      return () => ipcRenderer.removeListener(IPC.JOBS_NOTIFICATION, handler)
    },
  },

  // Approvals — write-tier actions awaiting the user's decision.
  approvals: {
    pending: () => ipcRenderer.invoke('approvals:pending'),
    history: (limit?: number) => ipcRenderer.invoke('approvals:history', limit),
    resolve: (id: string, approved: boolean) =>
      ipcRenderer.send('approval:resolve', { id, approved }),
    onRequest: (callback: (request: unknown) => void) => {
      const handler = (_: unknown, request: unknown) => callback(request)
      ipcRenderer.on('approval:request', handler)
      return () => ipcRenderer.removeListener('approval:request', handler)
    },
    onPendingChanged: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('approval:pending-changed', handler)
      return () => ipcRenderer.removeListener('approval:pending-changed', handler)
    },
  },

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('reigan', api)
