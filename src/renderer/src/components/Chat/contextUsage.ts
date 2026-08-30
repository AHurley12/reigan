import type { ChatMessage } from '../../../../shared/types'

export type GaugeBand = 'ok' | 'warn' | 'critical'

export interface GaugeReading {
  /** Tokens the next request will carry, as last measured. */
  used: number
  window: number
  /** 0–1, clamped. */
  fraction: number
  band: GaugeBand
  /** Short text label. Colour alone must never carry this. */
  label: string
}

/** Above this the conversation is worth watching; above CRITICAL it will fail soon. */
export const WARN_AT = 0.7
export const CRITICAL_AT = 0.9

/**
 * How full the model's context window is.
 *
 * Derived from the most recent *measured* turn rather than from a running
 * total: the input count on the latest request already includes the whole
 * history that was sent with it, so summing turns would count the same history
 * once per turn and overstate the load several times over.
 *
 * Returns null when nothing has been measured yet. An estimate here would look
 * identical on screen to a measurement and be wrong.
 */
export function readContextUsage(messages: ChatMessage[], contextWindow: number): GaugeReading | null {
  if (contextWindow <= 0) return null

  let latest: ChatMessage['usage'] | undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].usage) {
      latest = messages[i].usage
      break
    }
  }
  if (!latest) return null

  // What the next request carries: everything that went into the last one, plus
  // what came back, since the reply becomes history too.
  const used = latest.inputTokens + latest.outputTokens
  const fraction = Math.min(Math.max(used / contextWindow, 0), 1)

  const band: GaugeBand = fraction >= CRITICAL_AT ? 'critical' : fraction >= WARN_AT ? 'warn' : 'ok'

  return { used, window: contextWindow, fraction, band, label: LABELS[band] }
}

const LABELS: Record<GaugeBand, string> = {
  ok: 'Context',
  warn: 'Context filling',
  critical: 'Context nearly full',
}

/** Compact, and stable in width so the gauge does not jitter as it grows. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count)
  return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`
}
