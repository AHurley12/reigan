import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_ID,
  MAX_TEMPERATURE,
  MIN_THINKING_BUDGET,
  MODELS,
  resolveModel,
  resolveSampling,
} from './models'

describe('the catalogue', () => {
  it('contains the model the app shipped with, so the default is real', () => {
    expect(MODELS.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true)
  })

  it('has no duplicate ids', () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length)
  })

  it('gives every model a context window the gauge can divide by', () => {
    for (const model of MODELS) {
      expect(model.contextWindow, `${model.id} contextWindow`).toBeGreaterThan(0)
      expect(model.hint.length, `${model.id} hint`).toBeGreaterThan(0)
    }
  })

  it('falls back instead of throwing on an id that is no longer offered', () => {
    // A stale value in settings must not brick chat.
    expect(resolveModel('claude-from-2019').id).toBe(DEFAULT_MODEL_ID)
    expect(resolveModel(undefined).id).toBe(DEFAULT_MODEL_ID)
  })
})

describe('the default path is unchanged from what shipped', () => {
  // This is the regression guard for the whole phase. claude-sonnet-4-6 is not
  // in @langchain/anthropic's allowlist, so it sends temperature 1 and topP -1
  // unconditionally, and top_p: -1 is rejected by the API. temperature: null
  // clears it and leaves topP as the only sampling parameter.
  it('sends temperature null and topP 1 when nothing was chosen', () => {
    expect(resolveSampling({ modelSupportsThinking: true })).toEqual({ temperature: null, topP: 1 })
  })

  it('treats an explicitly null temperature as untouched', () => {
    expect(resolveSampling({ temperature: null, modelSupportsThinking: true })).toEqual({
      temperature: null,
      topP: 1,
    })
  })
})

describe('temperature and top_p are never both sent', () => {
  it('omits topP once a temperature is chosen', () => {
    const config = resolveSampling({ temperature: 0.3, modelSupportsThinking: true })

    expect(config.temperature).toBe(0.3)
    expect(config.topP).toBeUndefined()
    expect('topP' in config).toBe(false)
  })

  it('keeps zero, which is a real temperature and not "unset"', () => {
    const config = resolveSampling({ temperature: 0, modelSupportsThinking: true })

    expect(config.temperature).toBe(0)
    expect(config.topP).toBeUndefined()
  })

  it('clamps a temperature outside the accepted range', () => {
    expect(resolveSampling({ temperature: 5, modelSupportsThinking: true }).temperature).toBe(MAX_TEMPERATURE)
    expect(resolveSampling({ temperature: -1, modelSupportsThinking: true }).temperature).toBe(0)
    expect(resolveSampling({ temperature: NaN, modelSupportsThinking: true }).temperature).toBe(MAX_TEMPERATURE)
  })
})

describe('extended thinking fixes the sampling parameters', () => {
  it('sends neither topP nor an explicit temperature alongside thinking', () => {
    const config = resolveSampling({
      temperature: 0.2,
      thinkingEnabled: true,
      thinkingBudget: 8000,
      modelSupportsThinking: true,
    })

    expect(config.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
    expect(config.temperature).toBeNull()
    expect(config.topP).toBeUndefined()
  })

  it('raises a budget below the API minimum rather than sending an invalid one', () => {
    const config = resolveSampling({ thinkingEnabled: true, thinkingBudget: 10, modelSupportsThinking: true })

    expect(config.thinking?.budget_tokens).toBe(MIN_THINKING_BUDGET)
  })

  it('ignores the request on a model that does not support it', () => {
    const config = resolveSampling({ thinkingEnabled: true, modelSupportsThinking: false })

    expect(config.thinking).toBeUndefined()
    // Falls back to the default path rather than to a half-configured one.
    expect(config).toEqual({ temperature: null, topP: 1 })
  })
})
