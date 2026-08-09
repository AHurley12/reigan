import type { PerfStatus } from '../../../../../shared/types'

export const STATUS_COLOR: Record<PerfStatus, string> = {
  good: 'var(--active)',
  warning: 'var(--alert)',
  critical: 'var(--critical)',
}

export function statusFor(percent: number, warnAt: number, criticalAt: number): PerfStatus {
  if (percent >= criticalAt) return 'critical'
  if (percent >= warnAt) return 'warning'
  return 'good'
}
