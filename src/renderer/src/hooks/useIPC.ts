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
      getAllSettings: () => Promise<Record<string, string>>
      getSystemInfo: () => Promise<any>
      voice: {
        startListening: () => Promise<void>
        stopListening: () => Promise<void>
        sendAudioChunk: (buffer: ArrayBuffer) => void
        sendAmplitude: (rms: number) => void
        onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => () => void
        onAudioPlayback: (callback: (audioBuffer: ArrayBuffer) => void) => () => void
        onStateChange: (callback: (state: string) => void) => () => void
        onOrbAudio: (callback: (data: { amplitude: number; bass: number; mid: number; high: number }) => void) => () => void
        onError: (callback: (message: string) => void) => () => void
      }
      google: {
        getStatus: () => Promise<{ configured: boolean; connected: boolean }>
        connect: () => Promise<{ connected: boolean; error?: string }>
        disconnect: () => Promise<{ connected: boolean }>
      }
      calendar: {
        listEvents: (startDate: string, endDate: string) => Promise<{ connected: boolean; events: import('../../../shared/types').CalendarEvent[] }>
      }
      mail: {
        listThreads: (params: { category: import('../../../shared/types').MailCategory; unreadOnly?: boolean }) => Promise<{ connected: boolean; threads: import('../../../shared/types').MailThread[] }>
        categoryCounts: () => Promise<{ connected: boolean; counts: Record<import('../../../shared/types').MailCategory, number> }>
        getThread: (threadId: string) => Promise<import('../../../shared/types').MailThreadDetail | null>
        reply: (params: { threadId: string; to: string; subject: string; body: string }) => Promise<{ sent: boolean }>
        archive: (threadId: string) => Promise<{ archived: boolean }>
        setRead: (threadId: string, read: boolean) => Promise<{ ok: boolean }>
      }
      minimize: () => void
      maximize: () => void
      close: () => void
    }
  }
}

export function useIPC() {
  return window.reigan
}
