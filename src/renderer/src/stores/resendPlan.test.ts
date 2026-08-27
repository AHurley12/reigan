import { describe, expect, it } from 'vitest'
import { planResend } from './resendPlan'
import type { ChatMessage } from '../../../shared/types'

let clock = 1_700_000_000_000

function msg(role: 'user' | 'assistant', content: string, id = `${role}-${content}`): ChatMessage {
  clock += 1000
  return { id, role, content, timestamp: clock }
}

/** q1 → a1 → q2 → a2 */
function thread() {
  clock = 1_700_000_000_000
  return [msg('user', 'q1'), msg('assistant', 'a1'), msg('user', 'q2'), msg('assistant', 'a2')]
}

describe('regenerating a reply', () => {
  it('resends the question that produced it, not the reply', () => {
    const messages = thread()
    const plan = planResend(messages, 'assistant-a2')!

    expect(plan.text).toBe('q2')
  })

  it('keeps everything before that question and drops the rest', () => {
    const messages = thread()
    const plan = planResend(messages, 'assistant-a2')!

    expect(plan.keep.map((m) => m.content)).toEqual(['q1', 'a1'])
  })

  it('excludes the resent turn from history, which is sent separately', () => {
    // The regression this guards: including the turn in both history and the
    // message field shows the model the same question twice.
    const messages = thread()
    const plan = planResend(messages, 'assistant-a2')!

    expect(plan.history).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ])
  })

  it('reaches back past an earlier reply when regenerating the first answer', () => {
    const messages = thread()
    const plan = planResend(messages, 'assistant-a1')!

    expect(plan.text).toBe('q1')
    expect(plan.keep).toEqual([])
    expect(plan.history).toEqual([])
  })
})

describe('editing a user message', () => {
  it('sends the replacement text', () => {
    const messages = thread()
    const plan = planResend(messages, 'user-q2', 'q2 rewritten')!

    expect(plan.text).toBe('q2 rewritten')
  })

  it('drops the edited turn and everything after it', () => {
    const messages = thread()
    const plan = planResend(messages, 'user-q2', 'q2 rewritten')!

    expect(plan.keep.map((m) => m.content)).toEqual(['q1', 'a1'])
  })

  it('resends the original when no replacement is given', () => {
    const messages = thread()
    const plan = planResend(messages, 'user-q2')!

    expect(plan.text).toBe('q2')
  })

  it('trims the replacement so trailing whitespace is not sent as content', () => {
    const messages = thread()
    const plan = planResend(messages, 'user-q2', '  spaced  ')!

    expect(plan.text).toBe('spaced')
  })
})

describe('truncation point', () => {
  it('is the timestamp of the resent turn, so its own row is deleted too', () => {
    const messages = thread()
    const plan = planResend(messages, 'assistant-a2')!
    const q2 = messages.find((m) => m.id === 'user-q2')!

    expect(plan.truncateFromTimestamp).toBe(q2.timestamp)
  })
})

describe('cases with nothing to resend', () => {
  it('returns null for an unknown id', () => {
    expect(planResend(thread(), 'nope')).toBeNull()
  })

  it('returns null when a reply has no question before it', () => {
    // Can happen for a partial transcript, and resending nothing would send an
    // empty user turn to the model.
    const orphan = [msg('assistant', 'a0', 'assistant-a0')]

    expect(planResend(orphan, 'assistant-a0')).toBeNull()
  })

  it('returns null when the replacement text is blank', () => {
    expect(planResend(thread(), 'user-q2', '   ')).toBeNull()
  })
})
