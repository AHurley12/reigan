import { describe, expect, it } from 'vitest'
import { composeSystemPrompt, buildPromptTemplate } from './reigan'
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
    const out = composeSystemPrompt('standard', digest)

    expect(out.startsWith(REIGAN_SYSTEM_PROMPT)).toBe(true)
    expect(out).toContain('Works evenings')
  })
})

describe('buildPromptTemplate', () => {
  it('does not template-parse literal braces in a user-derived digest', async () => {
    // Fact bodies and project/job names in the digest are user-typed text,
    // never escaped for curly braces. If the system message were passed as a
    // ['system', text] tuple, ChatPromptTemplate would f-string-parse it and
    // throw on an unfulfilled "42" input variable here.
    const digest = '## What you know about this user\n- Sprint {42} retro planning\n'
    const systemPrompt = composeSystemPrompt('standard', digest)
    const prompt = buildPromptTemplate(systemPrompt)

    const formatted = await prompt.formatMessages({
      input: 'hi',
      chat_history: [],
      agent_scratchpad: [],
    })

    const systemMessage = formatted[0]
    expect(systemMessage.content).toContain('Sprint {42} retro planning')
  })
})
