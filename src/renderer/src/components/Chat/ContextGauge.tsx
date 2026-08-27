import React from 'react'
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { resolveModel } from '../../../../shared/models'
import { formatTokens, readContextUsage, type GaugeBand } from './contextUsage'

/** Reuses the existing status ramp rather than introducing new colour tokens. */
const BAND_COLOR: Record<GaugeBand, string> = {
  ok: 'var(--text-muted)',
  warn: 'var(--alert)',
  critical: 'var(--critical)',
}

/**
 * How full the model's context window is.
 *
 * This is the number that predicts failure on a long conversation, which is why
 * it is here and a running cost total is not. It reports what the API measured
 * and shows nothing at all until there is a measurement to show.
 */
export function ContextGauge() {
  const messages = useChatStore((s) => s.messages)
  const newConversation = useChatStore((s) => s.newConversation)
  const modelId = useSettingsStore((s) => s.settings.model)

  const reading = readContextUsage(messages, resolveModel(modelId).contextWindow)
  if (!reading) return null

  const color = BAND_COLOR[reading.band]

  return (
    <div className="flex items-center gap-2 px-4 pt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
      {/* Labelled as well as tinted: the band must not be readable by hue alone. */}
      <span style={{ color }}>{reading.label}</span>

      <div
        className="h-1 flex-1 max-w-[160px] rounded-full overflow-hidden"
        style={{ background: 'var(--bg-subtle)' }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={reading.window}
        aria-valuenow={reading.used}
        aria-label={`${reading.label}: ${reading.used} of ${reading.window} tokens`}
      >
        <div
          className="h-full transition-all duration-fast"
          style={{ width: `${reading.fraction * 100}%`, background: color }}
        />
      </div>

      <span style={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatTokens(reading.used)} / {formatTokens(reading.window)}
      </span>

      {/* No dead end: at the point where this starts to matter, say what to do
          about it. Truncating the history automatically would be the app
          silently discarding the user's conversation. */}
      {reading.band === 'critical' && (
        <button
          onClick={newConversation}
          className="ml-auto px-2 py-0.5 rounded-sm transition-colors"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          Start a new chat
        </button>
      )}
    </div>
  )
}
