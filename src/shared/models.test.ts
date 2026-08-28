import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_ID,
  MAX_TEMPERATURE,
  MIN_THINKING_BUDGET,
  MODELS,
  resolveModel,
  resolveRequestConfig,
} from './models'

const OPUS_5 = 'claude-opus-5'
const SONNET_5 = 'claude-sonnet-5'
const SONNET_4_6 = 'claude-sonnet-4-6'
const HAIKU_4_5 = 'claude-haiku-4-5-20251001'

describe('the catalogue', () => {
  it('contains the model the app shipped with, so the default is real', () => {
    expect(MODELS.some((m) => m.id === DEFAULT_MODEL_ID)).toBe(true)
  })

  it('has no duplicate ids', () => {
    expect(new Set(MODELS.map((m) => m.id)).size).toBe(MODELS.length)
  })

  it('falls back instead of throwing on an id that is no longer offered', () => {
    expect(resolveModel('claude-from-2019').id).toBe(DEFAULT_MODEL_ID)
    expect(resolveModel(undefined).id).toBe(DEFAULT_MODEL_ID)
  })
})

describe('context windows match the published specs', () => {
  // These were all 200_000, which made the gauge read five times too full on
  // three of the four models and offer "start a new chat" at under a fifth of
  // the real capacity.
  it('gives the 1M-context models their full window', () => {
    for (const id of [OPUS_5, SONNET_5, SONNET_4_6]) {
      expect(resolveModel(id).contextWindow, id).toBe(1_000_000)
    }
  })

  it('keeps Haiku 4.5 at its smaller 200K window', () => {
    expect(resolveModel(HAIKU_4_5).contextWindow).toBe(200_000)
  })
})

describe('thinking mode per model', () => {
  // Extended thinking (type "enabled" + budget_tokens) is rejected with a 400
  // on Claude 4.7 and later; adaptive thinking is rejected on 4.5 and earlier.
  // This was recorded backwards: Haiku 4.5 is the only one of the four that
  // takes a budget, and it was the only one marked as not supporting thinking.
  it('uses the manual budget only on Haiku 4.5', () => {
    expect(resolveModel(HAIKU_4_5).thinkingMode).toBe('budget')
  })

  it('uses adaptive thinking on every 4.6-and-later model', () => {
    for (const id of [OPUS_5, SONNET_5, SONNET_4_6]) {
      expect(resolveModel(id).thinkingMode, id).toBe('adaptive')
    }
  })
})

describe('models that reject sampling parameters', () => {
  // "Setting temperature, top_p, or top_k to any non-default value on Claude
  // Opus 4.7 or later models, including Claude Opus 5, returns a 400 error."
  for (const id of [OPUS_5, SONNET_5]) {
    it(`${id} never sends temperature, topP or a budget`, () => {
      const config = resolveRequestConfig({ model: id, temperature: 0.4, thinkingEnabled: true, thinkingBudget: 8000 })

      expect(config.temperature).toBeUndefined()
      expect(config.topP).toBeUndefined()
      expect(config.thinking).toEqual({ type: 'adaptive' })
    })

    it(`${id} deletes the sampling keys the library would otherwise send`, () => {
      // @langchain/anthropic only omits top_p for its own allowlist, and these
      // models are not on it — without this the request carries top_p: -1.
      const config = resolveRequestConfig({ model: id })

      expect(config.invocationKwargs).toEqual({
        temperature: undefined,
        top_p: undefined,
        top_k: undefined,
      })
      expect(Object.keys(config.invocationKwargs!)).toEqual(['temperature', 'top_p', 'top_k'])
    })

    it(`${id} still thinks when the toggle is off, because it always does`, () => {
      expect(resolveRequestConfig({ model: id, thinkingEnabled: false }).thinking).toEqual({ type: 'adaptive' })
    })
  }
})

describe('the shipped default path is unchanged', () => {
  // The regression guard for this whole change: Sonnet 4.6 works today and must
  // keep sending exactly what it sent before. claude-sonnet-4-6 is absent from
  // the library's allowlist, so it sends topP -1 unless temperature is
  // explicitly null, and top_p: -1 is rejected.
  it('sends temperature null and topP 1 with nothing configured', () => {
    expect(resolveRequestConfig({ model: SONNET_4_6 })).toEqual({ temperature: null, topP: 1 })
  })

  it('sends no thinking key at all when thinking is off', () => {
    const config = resolveRequestConfig({ model: SONNET_4_6, thinkingEnabled: false })

    expect(config.thinking).toBeUndefined()
    expect(config.invocationKwargs).toBeUndefined()
  })

  it('treats an explicitly null temperature as untouched', () => {
    expect(resolveRequestConfig({ model: SONNET_4_6, temperature: null })).toEqual({ temperature: null, topP: 1 })
  })

  it('omits topP once a temperature is chosen, so the two are never both sent', () => {
    const config = resolveRequestConfig({ model: SONNET_4_6, temperature: 0.3 })

    expect(config.temperature).toBe(0.3)
    expect('topP' in config).toBe(false)
  })

  it('keeps zero, which is a real temperature and not "unset"', () => {
    expect(resolveRequestConfig({ model: SONNET_4_6, temperature: 0 }).temperature).toBe(0)
  })

  it('clamps a temperature outside the accepted range', () => {
    expect(resolveRequestConfig({ model: SONNET_4_6, temperature: 5 }).temperature).toBe(MAX_TEMPERATURE)
    expect(resolveRequestConfig({ model: SONNET_4_6, temperature: -1 }).temperature).toBe(0)
    expect(resolveRequestConfig({ model: SONNET_4_6, temperature: NaN }).temperature).toBe(MAX_TEMPERATURE)
  })

  it('asks for adaptive thinking when the toggle is on', () => {
    expect(resolveRequestConfig({ model: SONNET_4_6, thinkingEnabled: true }).thinking).toEqual({ type: 'adaptive' })
  })
})

describe('Haiku 4.5 manual thinking', () => {
  it('sends a budget, and the temperature the library demands as a guard', () => {
    // @langchain/anthropic refuses to build the request unless temperature is
    // exactly 1 and topP is unset. It only checks them — the thinking branch
    // omits sampling from the body entirely.
    const config = resolveRequestConfig({ model: HAIKU_4_5, thinkingEnabled: true, thinkingBudget: 8000 })

    expect(config.thinking).toEqual({ type: 'enabled', budget_tokens: 8000 })
    expect(config.temperature).toBe(1)
    expect(config.topP).toBeUndefined()
  })

  it('raises a budget below the API minimum rather than sending an invalid one', () => {
    const config = resolveRequestConfig({ model: HAIKU_4_5, thinkingEnabled: true, thinkingBudget: 10 })

    expect(config.thinking).toEqual({ type: 'enabled', budget_tokens: MIN_THINKING_BUDGET })
  })

  it('never asks Haiku for adaptive thinking, which it rejects', () => {
    for (const enabled of [true, false]) {
      const config = resolveRequestConfig({ model: HAIKU_4_5, thinkingEnabled: enabled })
      expect(config.thinking).not.toEqual({ type: 'adaptive' })
    }
  })

  it('behaves like any sampling-accepting model with thinking off', () => {
    expect(resolveRequestConfig({ model: HAIKU_4_5, thinkingEnabled: false })).toEqual({
      temperature: null,
      topP: 1,
    })
  })
})

describe('no model is left in an unusable shape', () => {
  it('never sends a thinking budget to a model that rejects it', () => {
    for (const model of MODELS) {
      const config = resolveRequestConfig({ model: model.id, thinkingEnabled: true, thinkingBudget: 4096 })
      if (model.thinkingMode === 'adaptive') {
        expect(config.thinking, model.id).not.toHaveProperty('budget_tokens')
      }
    }
  })

  it('never sends a sampling parameter to a model that rejects it', () => {
    for (const model of MODELS.filter((m) => !m.acceptsSampling)) {
      const config = resolveRequestConfig({ model: model.id, temperature: 0.7 })
      expect(config.temperature, model.id).toBeUndefined()
      expect(config.topP, model.id).toBeUndefined()
    }
  })
})
