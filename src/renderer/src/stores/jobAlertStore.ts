import { create } from 'zustand'
import type { JobAlertKind, JobNotification } from '../../../shared/types'

/**
 * Durable record of every non-success outcome the scheduler has reported this
 * session.
 *
 * Separate from the toast store on purpose. A toast auto-dismisses after six
 * seconds, which is fine for "saved" and useless for "your nightly index has
 * been disabled for four days" — if the user was away from the machine, or
 * simply looking elsewhere, the only notice they would ever get is gone before
 * they see it. Alerts here persist until explicitly dismissed and are rendered
 * as a standing banner in Automations → Jobs, so the failure is still visible
 * whenever the user next looks.
 *
 * Toast and alert are complementary: the toast interrupts, the alert remembers.
 */

/** Exported so the bound is asserted rather than assumed — see the tests. */
export const MAX_ALERTS = 100

interface JobAlertStore {
  alerts: JobNotification[]
  /** Alerts not yet seen in the Jobs view — drives the sidebar badge. */
  unseen: number
  push: (alert: JobNotification) => void
  dismiss: (id: string) => void
  clear: () => void
  markAllSeen: () => void
}

export const useJobAlertStore = create<JobAlertStore>((set) => ({
  alerts: [],
  unseen: 0,

  push: (alert) =>
    set((s) => {
      // Newest first, and bounded — a job retry-looping overnight must not grow
      // this array without limit.
      const alerts = [alert, ...s.alerts].slice(0, MAX_ALERTS)
      // Clamped to what is actually still listed: once the cap starts evicting,
      // an uncapped counter would promise the rail more alerts than the banner
      // can show, and the badge would never clear.
      return { alerts, unseen: Math.min(s.unseen + 1, alerts.length) }
    }),

  dismiss: (id) =>
    set((s) => {
      const alerts = s.alerts.filter((a) => a.id !== id)
      // Dismissing is also a form of seeing it. Without the clamp the rail could
      // keep advertising alerts the user has already cleared away.
      return { alerts, unseen: Math.min(s.unseen, alerts.length) }
    }),

  clear: () => set({ alerts: [], unseen: 0 }),

  markAllSeen: () => set({ unseen: 0 }),
}))

/** Maps an alert kind to the toast variant that matches its severity. */
export function alertVariant(kind: JobAlertKind): 'error' | 'warning' | 'info' {
  switch (kind) {
    case 'disabled':
    case 'failure':
    case 'timeout':
      return 'error'
    case 'degraded':
    case 'skipped':
    case 'cancelled':
      return 'warning'
    case 'deferred':
    case 'awaiting_approval':
    case 'resumed':
    default:
      return 'info'
  }
}

/** Short label for the alert banner's status chip. */
export const ALERT_KIND_LABEL: Record<JobAlertKind, string> = {
  failure: 'Failed',
  timeout: 'Timed out',
  skipped: 'Skipped',
  deferred: 'Deferred',
  cancelled: 'Interrupted',
  awaiting_approval: 'Needs approval',
  disabled: 'Disabled',
  degraded: 'Completed with problems',
  resumed: 'Resumed',
}
