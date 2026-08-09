import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type ToastVariant } from '../../stores/toastStore'

const VARIANT_STYLE: Record<ToastVariant, { color: string; Icon: typeof Info }> = {
  error: { color: 'var(--critical)', Icon: AlertCircle },
  warning: { color: 'var(--alert)', Icon: AlertTriangle },
  info: { color: 'var(--info)', Icon: Info },
  success: { color: 'var(--active)', Icon: CheckCircle2 },
}

export function ToastStack() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2 w-[320px] pointer-events-none">
      {toasts.map((t) => {
        const { color, Icon } = VARIANT_STYLE[t.variant]
        return (
          <div
            key={t.id}
            className="animate-slide-up pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 rounded-lg"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border-hover)',
              boxShadow: 'var(--bevel-outer)',
            }}
          >
            <Icon size={16} style={{ color, flexShrink: 0, marginTop: 1 }} />
            <p className="text-xs flex-1" style={{ color: 'var(--text-primary)' }}>
              {t.message}
            </p>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 transition-colors hover:text-[var(--text-primary)]"
              style={{ color: 'var(--text-muted)' }}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
