import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'

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

  // System
  getSystemInfo: () => ipcRenderer.invoke(IPC.SYSTEM_INFO),

  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
}

contextBridge.exposeInMainWorld('reigan', api)
