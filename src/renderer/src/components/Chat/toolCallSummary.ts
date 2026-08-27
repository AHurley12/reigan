import type { ToolCallEvent } from '../../../../shared/types'

/**
 * Folds one tool event into the list a message is accumulating.
 *
 * A tool arrives twice: a start carrying its name and arguments, and an end
 * carrying its result and duration. Appending both would show every tool
 * twice — once permanently spinning — so they are merged on id, and each half
 * keeps whatever the other did not carry.
 */
export function mergeToolCall(
  existing: ToolCallEvent[] | undefined,
  incoming: ToolCallEvent
): ToolCallEvent[] {
  const list = existing ?? []
  const index = list.findIndex((c) => c.id === incoming.id)

  if (index === -1) return [...list, incoming].sort((a, b) => a.seq - b.seq)

  const previous = list[index]
  const merged: ToolCallEvent = {
    ...previous,
    ...incoming,
    // The end event carries no arguments, and the start carries no result.
    // A plain spread would blank whichever half arrived first.
    argsPreview: incoming.argsPreview ?? previous.argsPreview,
    resultPreview: incoming.resultPreview ?? previous.resultPreview,
    durationMs: incoming.durationMs ?? previous.durationMs,
  }

  const next = [...list]
  next[index] = merged
  return next
}

export interface ToolSummary {
  total: number
  running: number
  failed: number
  /** One line for the collapsed header. Never colour-dependent. */
  label: string
}

export function summariseToolCalls(calls: ToolCallEvent[]): ToolSummary {
  const total = calls.length
  const running = calls.filter((c) => c.status === 'running').length
  const failed = calls.filter((c) => c.status === 'error').length

  let label: string
  if (running > 0) {
    // Present tense while work is still happening — the point of showing this
    // live is that the user can see the agent working instead of an idle cursor.
    label = total === 1 ? 'Running 1 tool…' : `Running ${total} tools…`
  } else {
    label = total === 1 ? 'Used 1 tool' : `Used ${total} tools`
  }

  if (failed > 0) label += ` · ${failed} failed`

  return { total, running, failed, label }
}

/** Milliseconds, in the smallest unit that still reads as a duration. */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}
