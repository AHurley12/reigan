export interface TtsFailure {
  /** HTTP status where the SDK reported one. Recorded so a recurring failure is classifiable. */
  statusCode?: number
  /** What to show the user and write to the error log. Never empty. */
  message: string
}

/**
 * Turns a TTS failure into something a person can act on.
 *
 * The ElevenLabs SDK reports an auth failure as `Status code: 401\nBody: {}` —
 * a string that names no cause and suggests no fix. Shown to a user verbatim it
 * reads as the app being broken, when the actual remedy is a new API key.
 *
 * Only the statuses that mean genuinely different things to the user are
 * translated; everything else passes through, because inventing an explanation
 * for an unfamiliar failure is worse than showing the real one.
 */
export function describeTtsFailure(err: unknown): TtsFailure {
  const e = err as { statusCode?: number; status?: number; message?: unknown } | null
  const statusCode = e?.statusCode ?? e?.status

  const raw =
    typeof e?.message === 'string' && e.message.trim()
      ? e.message
      : typeof err === 'string' && err.trim()
        ? err
        : 'ElevenLabs failed to generate speech, and gave no reason.'

  switch (statusCode) {
    case 401:
      return {
        statusCode,
        message:
          'ElevenLabs rejected the API key (401). The key saved in Settings is no longer valid — ' +
          'generate a new one at elevenlabs.io and paste it in, then restart so the change is picked up.',
      }
    case 402:
      return {
        statusCode,
        message:
          "ElevenLabs rejected this request (402) — either this voice isn't included in your plan, " +
          "or you're out of character quota. Try a different voice in Settings, or check your ElevenLabs account.",
      }
    case 429:
      return {
        statusCode,
        message:
          'ElevenLabs is rate limiting this account (429) — too many requests in a short window. ' +
          'The reply is on screen; speech will work again shortly.',
      }
    default:
      return statusCode === undefined ? { message: raw } : { statusCode, message: raw }
  }
}
