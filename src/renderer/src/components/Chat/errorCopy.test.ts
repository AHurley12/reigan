import { describe, expect, it } from 'vitest'
import { describeChatError } from './errorCopy'

describe('recognised failures name the problem and the way out', () => {
  it('tells someone where to fix a rejected key', () => {
    const result = describeChatError('401 {"type":"authentication_error","message":"invalid x-api-key"}')

    expect(result.title).toBe('Your API key was rejected')
    expect(result.guidance).toContain('Settings')
  })

  it('does not offer retry for a problem retrying cannot fix', () => {
    // Resending an identical request with the same bad key just fails again.
    expect(describeChatError('invalid api key').retryable).toBe(false)
    expect(describeChatError('credit balance is too low').retryable).toBe(false)
  })

  it('offers retry for transient failures', () => {
    expect(describeChatError('429 rate_limit_error').retryable).toBe(true)
    expect(describeChatError('529 overloaded_error').retryable).toBe(true)
    expect(describeChatError('fetch failed').retryable).toBe(true)
    expect(describeChatError('ETIMEDOUT').retryable).toBe(true)
  })

  it('sends an over-long conversation to the fix that actually works', () => {
    const result = describeChatError('prompt is too long: 210000 tokens > 200000 maximum')

    expect(result.title).toBe('This conversation is too long')
    expect(result.guidance).toMatch(/new chat|shorten/i)
    expect(result.retryable).toBe(false)
  })
})

describe('ordering', () => {
  it('prefers the specific rule when a message could match two', () => {
    // Contains "api_error" as well, which a later, broader rule also matches.
    const result = describeChatError('rate_limit_error: too many requests (429 api_error)')

    expect(result.title).toBe('Rate limited')
  })
})

describe('unrecognised failures', () => {
  it('surfaces the original message verbatim', () => {
    // Replacing an unknown error with a generic line throws away the only part
    // anyone could act on, and makes the next unmatched error undebuggable too.
    const raw = 'ReferenceError: buildAgentTools is not defined'

    expect(describeChatError(raw).guidance).toBe(raw)
  })

  it('still offers retry, since nothing rules it out', () => {
    expect(describeChatError('something exotic').retryable).toBe(true)
  })

  it('handles a failure that carried no message at all', () => {
    expect(describeChatError('').title).toBe('That did not work')
    expect(describeChatError('   ').guidance).toMatch(/without saying why/)
  })
})

describe('every presentation is usable', () => {
  const samples = [
    '401 unauthorized',
    '429 rate_limit',
    '529 overloaded',
    'fetch failed',
    'ETIMEDOUT',
    'billing',
    '403 permission_error',
    '500 internal server error',
    'context_length exceeded',
    'totally unknown',
  ]

  it('never returns an empty title or guidance', () => {
    for (const sample of samples) {
      const result = describeChatError(sample)
      expect(result.title.length, `${sample} title`).toBeGreaterThan(0)
      expect(result.guidance.length, `${sample} guidance`).toBeGreaterThan(0)
    }
  })

  it('never repeats the title back as the guidance', () => {
    for (const sample of samples) {
      const result = describeChatError(sample)
      expect(result.guidance, `${sample} guidance`).not.toBe(result.title)
    }
  })
})
