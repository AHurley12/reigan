import { create } from 'zustand'

export type ToastVariant = 'error' | 'warning' | 'info' | 'success'

export interface ToastItem {
  id: string
  message: string
  variant: ToastVariant
}

interface ToastStore {
  toasts: ToastItem[]
  push: (message: string, variant?: ToastVariant) => string
  dismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 6000

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  push: (message, variant = 'error') => {
    const id = crypto.randomUUID()
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    setTimeout(() => get().dismiss(id), AUTO_DISMISS_MS)
    return id
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
