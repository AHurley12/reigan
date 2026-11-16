import { describe, it, expect } from 'vitest'
import { describeTtsFailure } from './ttsError'

/**
 * The ElevenLabs SDK reports an auth failure as `Status code: 401\nBody: {}`,
 * which is what a user saw and reported — a string that names no cause and
 * suggests no action. Worse, `speak()` swallowed it into a toast, so nothing
 * reached the error log and there was no trail to debug from at all.
 *
 * These tests pin the translation: every failure gets a message that says what
 * went wrong, and a status code the caller can record.
 */
describe('describeTtsFailure', () => {
  it('explains a 401 as a rejected key rather than a bare status line', () => {
    const d = describeTtsFailure({ statusCode: 401, message: 'Status code: 401\nBody: {}' })
    expect(d.statusCode).toBe(401)
    expect(d.message).toMatch(/401/)
    expect(d.message).toMatch(/key/i)
    expect(d.message).not.toBe('Status code: 401\nBody: {}')
  })

  it('keeps the existing 402 wording, which distinguishes plan from quota', () => {
    const d = describeTtsFailure({ statusCode: 402, message: 'Status code: 402' })
    expect(d.statusCode).toBe(402)
    expect(d.message).toMatch(/402/)
    expect(d.message).toMatch(/quota|plan/i)
  })

  it('reads the status off `status` when the SDK used that name instead', () => {
    expect(describeTtsFailure({ status: 401, message: 'nope' }).statusCode).toBe(401)
  })

  it('passes an ordinary error through untouched', () => {
    const err = new Error('TTS stream stalled — no audio received in time.')
    const d = describeTtsFailure(err)
    expect(d.statusCode).toBeUndefined()
    expect(d.message).toBe('TTS stream stalled — no audio received in time.')
  })

  it('never returns an empty message, whatever it was handed', () => {
    for (const input of [null, undefined, {}, 'plain string', 42]) {
      expect(describeTtsFailure(input).message.length).toBeGreaterThan(0)
    }
  })

  it('names the service for a 429, so a rate limit is not read as a key problem', () => {
    const d = describeTtsFailure({ statusCode: 429, message: 'Status code: 429' })
    expect(d.message).toMatch(/429/)
    expect(d.message).toMatch(/too many|rate/i)
  })
})
