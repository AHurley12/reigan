import { describe, expect, it } from 'vitest'
import { reduceStreamFrame, type StreamState } from './streamReducer'
import type { ChatDoneReason, ChatMessage, ChatStreamFrame } from '../../../shared/types'

const REQUEST = 'req-1'
const ASSISTANT_ID = 'assistant-1'

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: ASSISTANT_ID,
    role: 'assistant',
    content: '',
    timestamp: 1_700_000_000_000,
    isStreaming: true,
    ...over,
  }
}

function streaming(over: Partial<StreamState> = {}): StreamState {
  return {
    messages: [
      { id: 'user-1', role: 'user', content: 'hello', timestamp: 1_699_999_999_000 },
      message(),
    ],
    isStreaming: true,
    streamingId: ASSISTANT_ID,
    requestId: REQUEST,
    ...over,
  }
}

function token(text: string, requestId = REQUEST): ChatStreamFrame {
  return { requestId, conversationId: 'conv-1', event: { kind: 'token', text } }
}

function done(reason: ChatDoneReason, msg?: string, requestId = REQUEST): ChatStreamFrame {
  return { requestId, conversationId: 'conv-1', event: { kind: 'done', reason, message: msg } }
}

const assistant = (s: StreamState) => s.messages.find((m) => m.id === ASSISTANT_ID)!

describe('token routing', () => {
  it('appends each token to the message being streamed', () => {
    let state = streaming()
    state = reduceStreamFrame(state, token('Hel'))
    state = reduceStreamFrame(state, token('lo'))

    expect(assistant(state).content).toBe('Hello')
  })

  it('leaves every other message untouched', () => {
    const state = reduceStreamFrame(streaming(), token('hi'))

    expect(state.messages[0].content).toBe('hello')
  })

  it('ignores an empty token rather than allocating a new state for nothing', () => {
    const before = streaming()

    expect(reduceStreamFrame(before, token(''))).toBe(before)
  })
})

describe('a superseded request cannot write into the current one', () => {
  // The regression this guards: stop, then immediately resend. The first
  // generation is still draining in main, and its remaining tokens used to
  // append to the new assistant message — the model appearing to repeat itself.
  it('drops tokens carrying a different requestId', () => {
    const before = streaming()
    const after = reduceStreamFrame(before, token('stale text', 'req-0'))

    expect(after).toBe(before)
    expect(assistant(after).content).toBe('')
  })

  it('drops a done frame carrying a different requestId', () => {
    const before = streaming()
    const after = reduceStreamFrame(before, done('complete', undefined, 'req-0'))

    expect(after).toBe(before)
    expect(after.isStreaming).toBe(true)
  })

  it('drops everything once the stream has been finalized', () => {
    const finished = reduceStreamFrame(streaming(), done('complete'))
    const after = reduceStreamFrame(finished, token('late'))

    expect(after).toBe(finished)
    expect(assistant(after).content).toBe('')
  })
})

describe('finalization', () => {
  it('clears the streaming flags so the composer can accept a new send', () => {
    const state = reduceStreamFrame(streaming(), done('complete'))

    expect(state.isStreaming).toBe(false)
    expect(state.streamingId).toBeNull()
    expect(state.requestId).toBeNull()
    expect(assistant(state).isStreaming).toBe(false)
  })

  it('marks a stopped reply and keeps the text that already arrived', () => {
    let state = streaming()
    state = reduceStreamFrame(state, token('partial answ'))
    state = reduceStreamFrame(state, done('aborted'))

    expect(assistant(state).stoppedByUser).toBe(true)
    expect(assistant(state).content).toBe('partial answ')
    expect(assistant(state).error).toBeUndefined()
  })

  it('records a failure as a property of the turn, never as assistant content', () => {
    // Errors used to be pushed down the channel as tokens, so they were
    // indistinguishable from model output and got persisted as if the
    // assistant had said them.
    let state = streaming()
    state = reduceStreamFrame(state, token('here is the ans'))
    state = reduceStreamFrame(state, done('error', 'overloaded_error'))

    expect(assistant(state).error).toBe('overloaded_error')
    expect(assistant(state).content).toBe('here is the ans')
  })

  it('falls back to a readable message when the failure carried none', () => {
    const state = reduceStreamFrame(streaming(), done('error'))

    expect(assistant(state).error).toBe('Something went wrong.')
  })

  it('does not mark a normally completed reply as stopped or failed', () => {
    const state = reduceStreamFrame(streaming(), done('complete'))

    expect(assistant(state).stoppedByUser).toBeUndefined()
    expect(assistant(state).error).toBeUndefined()
  })
})

describe('frames arriving with nothing to write to', () => {
  it('ignores a frame when no message is being streamed', () => {
    const before = streaming({ streamingId: null })

    expect(reduceStreamFrame(before, token('x'))).toBe(before)
  })

  it('ignores a frame when no request is in flight', () => {
    const before = streaming({ requestId: null })

    expect(reduceStreamFrame(before, token('x'))).toBe(before)
  })
})
