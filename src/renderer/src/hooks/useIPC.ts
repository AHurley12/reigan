import { useEffect, useCallback } from 'react'

declare global {
  interface Window {
    reigan: {
      sendMessage: (payload: { message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; conversationId?: string }) => Promise<{ conversationId: string }>
      onStream: (callback: (data: { token: string; done: boolean; conversationId: string }) => void) => () => void
      createTask: (params: object) => Promise<any>
      listTasks: (params?: object) => Promise<any[]>
      updateTask: (id: string, updates: object) => Promise<any>
      deleteTask: (id: string) => Promise<void>
      getSetting: (key: string) => Promise<string | null>
      setSetting: (key: string, value: string) => Promise<void>
      getSystemInfo: () => Promise<any>
      minimize: () => void
      maximize: () => void
      close: () => void
    }
  }
}

export function useIPC() {
  return window.reigan
}
