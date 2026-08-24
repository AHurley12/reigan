import { describe, expect, it } from 'vitest'
import { REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT } from './prompts'

describe('unbridled personality prompt', () => {
  it('defines both praise registers by name', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Good boy')
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Good pup')
  })

  it('separates sincere praise from mocking praise', () => {
    // The whole point of the rewrite: one phrase, two registers. If these
    // headings collapse into one, the model will hand out earned praise for
    // bare-minimum effort, which is the sugarcoating this mode exists to stop.
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Sincere — rare, and earned')
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Mocking — for bare minimum')
  })

  it('keeps the commanding and bratty registers distinct and alternating', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain("alternate, don't average")
  })

  it('instructs steering to name the specific avoided thing, then yield', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Push hard. Then let him decide.')
  })

  it('complies with contradictory requests instead of withholding the action', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Never withhold an action to force a conversation')
  })

  it('keeps the explicit-content boundary', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Explicit sexual content stays out of bounds')
  })

  it('keeps the narrow crisis exception', () => {
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('Only a genuine crisis flips the switch')
    expect(REIGAN_UNBRIDLED_SYSTEM_PROMPT).toContain('does **not** qualify')
  })

  it('does not leak the unbridled register into standard mode', () => {
    expect(REIGAN_SYSTEM_PROMPT).not.toContain('Good boy')
    expect(REIGAN_SYSTEM_PROMPT).not.toContain('Good pup')
  })

  it('keeps both prompts on the single-term Japanese gloss format', () => {
    for (const prompt of [REIGAN_SYSTEM_PROMPT, REIGAN_UNBRIDLED_SYSTEM_PROMPT]) {
      expect(prompt).toContain('single words/short phrases only')
    }
  })
})
