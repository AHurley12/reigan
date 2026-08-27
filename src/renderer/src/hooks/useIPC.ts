declare global {
  interface Window {
    reigan: {
      initialThemeId: string
      sendMessage: (payload: { message: string; history: Array<{ role: 'user' | 'assistant'; content: string }>; conversationId?: string; requestId?: string; truncateFromTimestamp?: number }) => Promise<{ conversationId: string; requestId: string }>
      abortMessage: (requestId: string) => Promise<boolean>
      onStream: (callback: (frame: import('../../../shared/types').ChatStreamFrame) => void) => () => void
      createTask: (params: object) => Promise<any>
      listTasks: (params?: object) => Promise<any[]>
      updateTask: (id: string, updates: object) => Promise<any>
      deleteTask: (id: string) => Promise<void>
      getSetting: (key: string) => Promise<string | null>
      setSetting: (key: string, value: string) => Promise<void>
      getAllSettings: () => Promise<Record<string, string>>
      getSecretPreviews: () => Promise<Record<string, { hasValue: boolean; last4: string }>>
      getSystemInfo: () => Promise<any>
      voice: {
        startListening: () => Promise<void>
        stopListening: () => Promise<void>
        stopSpeaking: () => Promise<void>
        sendAudioChunk: (buffer: ArrayBuffer) => void
        sendAmplitude: (rms: number) => void
        onTranscript: (callback: (data: { text: string; isFinal: boolean }) => void) => () => void
        onAudioPlayback: (callback: (audioBuffer: Uint8Array) => void) => () => void
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
      avatar: {
        saveModel: (data: ArrayBuffer) => Promise<{ success: boolean }>
        loadModel: () => Promise<Uint8Array | null>
      }
      files: {
        listDir: (dirPath?: string) => Promise<import('../../../shared/types').FileEntry[]>
        search: (params: import('../../../shared/types').FileSearchParams) => Promise<import('../../../shared/types').FileEntry[]>
        indexStatus: () => Promise<import('../../../shared/types').FileIndexStatus>
        reindex: () => Promise<{ started: boolean }>
        readContent: (filePath: string) => Promise<{ content: string; truncated: boolean } | null>
        open: (filePath: string) => Promise<{ opened: boolean }>
        reveal: (filePath: string) => Promise<{ revealed: boolean }>
      }
      jobs: {
        onNotification: (
          callback: (event: import('../../../shared/types').JobNotification) => void
        ) => () => void
      }
      perf: {
        staticInfo: () => Promise<import('../../../shared/types').PerfStaticInfo>
        start: () => Promise<{ started: boolean }>
        stop: () => Promise<{ stopped: boolean }>
        onSample: (callback: (sample: import('../../../shared/types').PerfSample) => void) => () => void
      }
      // Contract lives in shared/ so preload and renderer share one definition
      // without the renderer importing across the process boundary.
      auth: import('../../../shared/auth-types').VoiceAuthBridge
      // Generic capability surface — no per-feature bridge method. Anything
      // registered in main/capabilities is reachable through invoke().
      capabilities: {
        invoke: <T = unknown>(
          id: string,
          args?: unknown,
          invocationId?: string
        ) => Promise<import('../../../shared/types').CapabilityInvokeResult<T>>
        cancel: (invocationId: string) => Promise<boolean>
        list: () => Promise<
          Array<{
            id: string
            title: string
            description: string
            risk: import('../../../shared/types').RiskTier
            uiOnly: boolean
            uiOnlyReason?: string
            requiresApproval: boolean
            requiresGoogle: boolean
          }>
        >
        onProgress: (
          callback: (data: { invocationId: string; done: number; total: number; label?: string }) => void
        ) => () => void
      }
      approvals: {
        pending: () => Promise<import('../../../shared/types').PendingApproval[]>
        history: (limit?: number) => Promise<import('../../../shared/types').PendingApproval[]>
        resolve: (id: string, approved: boolean) => void
        onRequest: (
          callback: (request: import('../../../shared/types').PendingApproval) => void
        ) => () => void
        onPendingChanged: (callback: () => void) => () => void
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
