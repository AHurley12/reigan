/**
 * The models Reigan can talk to, and the sampling rules that keep the request
 * valid.
 *
 * One source of truth: the Settings picker, the executor, and the context gauge
 * all read this. Context windows and thinking support are facts about the API
 * and must be checked against docs.anthropic.com when models change — they are
 * named fields here precisely so there is one place to correct.
 */

export interface ModelInfo {
  id: string
  label: string
  /** One line on when to reach for it. Shown under the picker. */
  hint: string
  /** Total tokens the model can hold, used by the context gauge. */
  contextWindow: number
  /**
   * Whether extended thinking may be requested.
   *
   * Conservative by design: a model marked false simply cannot enable the
   * toggle, whereas a wrong `true` produces a 400 at send time.
   */
  supportsThinking: boolean
}

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    hint: 'The default. Balanced capability and speed.',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    hint: 'Most capable. Slower, and costs the most per token.',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    hint: 'Strong general-purpose model, faster than Opus.',
    contextWindow: 200_000,
    supportsThinking: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    hint: 'Fastest and cheapest. Good for short, routine work.',
    contextWindow: 200_000,
    supportsThinking: false,
  },
]

/** What the app used before the picker existed. Changing this changes behaviour. */
export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6'

function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id)
}

/** Falls back rather than throwing: an unknown id in settings must not brick chat. */
export function resolveModel(id: string | undefined): ModelInfo {
  return findModel(id ?? '') ?? findModel(DEFAULT_MODEL_ID) ?? MODELS[0]
}

/** Anthropic requires a minimum thinking budget, and it must fit inside max_tokens. */
export const MIN_THINKING_BUDGET = 1024
export const DEFAULT_THINKING_BUDGET = 4096

export interface SamplingConfig {
  /** `null` clears it — JSON.stringify drops `undefined`, so null is load-bearing. */
  temperature: number | null
  topP?: number
  thinking?: { type: 'enabled'; budget_tokens: number }
}

export interface SamplingRequest {
  /** Undefined means "leave it alone", which is not the same as 0. */
  temperature?: number | null
  thinkingEnabled?: boolean
  thinkingBudget?: number
  modelSupportsThinking: boolean
}

/**
 * Decides what sampling parameters to send.
 *
 * Three rules, all of which produce a 400 if broken:
 *
 *  1. `temperature` and `top_p` must never both be set.
 *  2. `claude-sonnet-4-6` is absent from @langchain/anthropic's model allowlist,
 *     so the library sends its own defaults (temperature 1, topP -1)
 *     unconditionally, and `top_p: -1` is rejected. Explicit `temperature: null`
 *     clears it and leaves topP as the only sampling parameter. That is the
 *     shipped behaviour and the default path must reproduce it exactly.
 *  3. Extended thinking requires the default temperature and no top_p at all.
 */
export function resolveSampling(request: SamplingRequest): SamplingConfig {
  const thinking =
    request.thinkingEnabled && request.modelSupportsThinking
      ? {
          type: 'enabled' as const,
          budget_tokens: Math.max(request.thinkingBudget ?? DEFAULT_THINKING_BUDGET, MIN_THINKING_BUDGET),
        }
      : undefined

  // Rule 3 wins over everything: thinking fixes sampling, so neither an explicit
  // temperature nor the topP workaround may be sent alongside it.
  if (thinking) return { temperature: null, thinking }

  // Rule 2: the untouched default, byte-for-byte what the app sent before the
  // picker existed.
  if (request.temperature === undefined || request.temperature === null) {
    return { temperature: null, topP: 1 }
  }

  // Rule 1: an explicit temperature means topP is omitted entirely.
  return { temperature: clampTemperature(request.temperature) }
}

export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 1

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return MAX_TEMPERATURE
  return Math.min(Math.max(value, MIN_TEMPERATURE), MAX_TEMPERATURE)
}
