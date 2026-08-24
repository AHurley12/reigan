import { describe, expect, it } from 'vitest'
import { composeSystemPrompt } from './reigan'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'

describe('composeSystemPrompt', () => {
  it('returns the bare persona when nothing is known yet', () => {
    expect(composeSystemPrompt('standard', '')).toBe(REIGAN_SYSTEM_PROMPT)
    expect(composeSystemPrompt('unbridled', '')).toBe(REIGAN_UNBRIDLED_SYSTEM_PROMPT)
  })

  it('appends the digest after the persona', () => {
    const digest = '## What you know about this user\n- Works evenings\n'
    const out = composeSystemPrompt('unbridled', digest)

    expect(out.startsWith(REIGAN_UNBRIDLED_SYSTEM_PROMPT)).toBe(true)
    expect(out).toContain('Works evenings')
  })

  it('feeds the same digest to standard mode', () => {
    // The context layer is shared; only the delivery differs between modes.
    const digest = '## What you know about this user\n- Works evenings\n'
    expect(composeSystemPrompt('standard', digest)).toContain('Works evenings')
  })
})
