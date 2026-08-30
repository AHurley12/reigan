/**
 * The models Reigan can talk to, and the request rules that keep each one valid.
 *
 * One source of truth: the Settings picker, the executor, and the context gauge
 * all read this. Every fact below is from platform.claude.com — the models
 * overview, the per-model pages, and the extended-thinking page — not from
 * recall. Re-check them here when the lineup changes; nothing else needs to
 * know.
 */

/**
 * How a model is asked to think.
 *
 * `adaptive` — the model decides, steered by effort. `thinking: {type:
 * "enabled", budget_tokens: N}` is rejected with a 400 on Claude 4.7 and later.
 *
 * `budget`   — the older manual mode. `{type: "enabled", budget_tokens: N}`,
 * minimum 1024, and `{type: "adaptive"}` is a 400 instead.
 */
export type ThinkingMode = 'adaptive' | 'budget'

export interface ModelInfo {
  id: string
  label: string
  /** One line on when to reach for it. Shown under the picker. */
  hint: string
  /** Total tokens the model can hold, used by the context gauge. */
  contextWindow: number
  thinkingMode: ThinkingMode
  /**
   * Whether `temperature` / `top_p` / `top_k` may be sent at all.
   *
   * False from Claude Opus 4.7 onward: "Setting temperature, top_p, or top_k to
   * any non-default value on Claude Opus 4.7 or later models, including Claude
   * Opus 5, returns a 400 error."
   */
  acceptsSampling: boolean
}

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    hint: 'The default. Balanced capability and speed.',
    contextWindow: 1_000_000,
    thinkingMode: 'adaptive',
    acceptsSampling: true,
  },
  {
    id: 'claude-opus-5',
    label: 'Opus 5',
    hint: 'Most capable. Thinks on every turn, and costs the most per token.',
    contextWindow: 1_000_000,
    thinkingMode: 'adaptive',
    acceptsSampling: false,
  },
  {
    id: 'claude-sonnet-5',
    label: 'Sonnet 5',
    hint: 'Strong general-purpose model, faster and cheaper than Opus 5.',
    contextWindow: 1_000_000,
    thinkingMode: 'adaptive',
    acceptsSampling: false,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    hint: 'Fastest and cheapest, with a smaller 200K context window.',
    contextWindow: 200_000,
    thinkingMode: 'budget',
    acceptsSampling: true,
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

/** The API rejects a smaller budget, and it must leave room inside max_tokens. */
export const MIN_THINKING_BUDGET = 1024
export const DEFAULT_THINKING_BUDGET = 4096

export const MIN_TEMPERATURE = 0
export const MAX_TEMPERATURE = 1

/**
 * What `buildExecutor` spreads into `new ChatAnthropic({...})`.
 *
 * `invocationKwargs` is spread last into the request body by
 * @langchain/anthropic, so an `undefined` here deletes a key the library would
 * otherwise send — which is the only way to omit sampling parameters for a
 * model that is not on its internal allowlist.
 */
export interface RequestConfig {
  /** `null` clears it — JSON.stringify drops `undefined`, so null is load-bearing. */
  temperature?: number | null
  topP?: number
  thinking?: { type: 'adaptive' } | { type: 'enabled'; budget_tokens: number }
  invocationKwargs?: Record<string, unknown>
}

export interface RequestRequest {
  model: string
  /** Undefined means "leave it alone", which is not the same as 0. */
  temperature?: number | null
  thinkingEnabled?: boolean
  thinkingBudget?: number
}

/**
 * Decides the per-model request shape.
 *
 * Three rules, each of which is a 400 when broken:
 *
 *  1. `temperature` and `top_p` must never both be set.
 *  2. Claude Opus 4.7 and later reject any non-default `temperature`, `top_p`
 *     or `top_k`. @langchain/anthropic only omits `top_p` for models matching
 *     its `opus-4-1|sonnet-4-5|haiku-4-5` allowlist, and otherwise always sends
 *     one — so those keys have to be deleted through `invocationKwargs`.
 *  3. `{type: "enabled", budget_tokens}` is rejected on Claude 4.7 and later;
 *     `{type: "adaptive"}` is rejected on Claude 4.5 and earlier.
 */
export function resolveRequestConfig(request: RequestRequest): RequestConfig {
  const model = resolveModel(request.model)

  // Claude 4.5-era manual thinking. @langchain/anthropic refuses to build the
  // request unless temperature is exactly 1 and topP is unset — it is only
  // checking, not sending: the thinking branch omits sampling entirely.
  if (model.thinkingMode === 'budget' && request.thinkingEnabled) {
    return {
      temperature: 1,
      thinking: {
        type: 'enabled',
        budget_tokens: Math.max(request.thinkingBudget ?? DEFAULT_THINKING_BUDGET, MIN_THINKING_BUDGET),
      },
    }
  }

  if (!model.acceptsSampling) {
    // Opus 5 / Sonnet 5. Thinking is adaptive and on by default on these
    // models, so it is always requested rather than being tied to the toggle —
    // reporting it as off would be a fiction. Disabling it outright is also a
    // documented hazard on Opus 5: with thinking off the model sometimes writes
    // a tool call into its visible text instead of making one, which in an
    // agentic loop fails silently.
    //
    // No `output_config.effort` is sent: the API default is already `high`, and
    // adding a setting for it is not what makes these models work.
    return {
      thinking: { type: 'adaptive' },
      invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
    }
  }

  // Everything below is a model that accepts sampling, and reproduces exactly
  // what the app sent before the picker existed.
  const thinking = model.thinkingMode === 'adaptive' && request.thinkingEnabled
    ? ({ type: 'adaptive' } as const)
    : undefined

  // Rule 2's workaround for the *default* path: claude-sonnet-4-6 is absent
  // from the library's allowlist, so it sends temperature 1 and topP -1 unless
  // told otherwise, and `top_p: -1` is rejected. Explicit `temperature: null`
  // clears it and leaves topP as the only sampling parameter.
  if (request.temperature === undefined || request.temperature === null) {
    return { temperature: null, topP: 1, ...(thinking ? { thinking } : {}) }
  }

  // Rule 1: an explicit temperature means topP is omitted entirely.
  return { temperature: clampTemperature(request.temperature), ...(thinking ? { thinking } : {}) }
}

function clampTemperature(value: number): number {
  if (!Number.isFinite(value)) return MAX_TEMPERATURE
  return Math.min(Math.max(value, MIN_TEMPERATURE), MAX_TEMPERATURE)
}
