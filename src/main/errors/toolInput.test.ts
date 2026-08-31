import { describe, expect, it } from 'vitest'
import { describeToolInputFailure } from './toolInput'

/**
 * A tool-schema rejection must name the tool that was rejected.
 *
 * The gap this pins: LangChain throws one fixed sentence — "Received tool input
 * did not match expected schema" — and attaches the offending call to the
 * exception's `output`, which nothing read. So the error log held a single
 * anonymous row that said a tool had been called wrongly and nothing about
 * which one, with what, or how often. Every tool's failures also collapsed onto
 * that one row, because the message they fingerprint on was identical.
 */

function langchainFailure(toolCall: unknown, details?: string): Error {
  const message =
    'Received tool input did not match expected schema' + (details ? `\nDetails: ${details}` : '')
  return Object.assign(new Error(message), { output: JSON.stringify(toolCall) })
}

describe('describeToolInputFailure', () => {
  it('names the tool and keeps the input that was rejected', () => {
    const failure = describeToolInputFailure(
      langchainFailure({
        name: 'youtube_listVideos',
        args: { tier: 'excellent', limit: 5 },
        id: 'toolu_01',
        type: 'tool_call',
      })
    )

    expect(failure?.toolName).toBe('youtube_listVideos')
    expect(failure?.message).toContain('youtube_listVideos')
    expect(failure?.input).toContain('excellent')
  })

  it('carries the schema details through when the tool reported them', () => {
    const failure = describeToolInputFailure(
      langchainFailure(
        { name: 'jobs_enable', args: {} },
        'Required at "id"'
      )
    )

    expect(failure?.message).toContain('Required at "id"')
  })

  it('still identifies the failure when the payload is unreadable', () => {
    // Degrading to "some tool" is the point: an unparseable `output` must not
    // cost us the far more useful fact that a schema rejection happened at all.
    const failure = describeToolInputFailure(
      Object.assign(new Error('Received tool input did not match expected schema'), {
        output: 'not json{',
      })
    )

    expect(failure).not.toBeNull()
    expect(failure?.toolName).toBe('unknown')
  })

  it('truncates a large payload rather than storing it whole', () => {
    // These land in the error log verbatim; a pasted document as a tool argument
    // should not become a megabyte-wide row.
    const failure = describeToolInputFailure(
      langchainFailure({ name: 'files_write', args: { body: 'x'.repeat(50_000) } })
    )

    expect(failure!.input.length).toBeLessThan(3000)
    expect(failure!.input).toContain('truncated')
  })

  it('ignores errors that are not a schema rejection', () => {
    expect(describeToolInputFailure(new Error('fetch failed'))).toBeNull()
    expect(describeToolInputFailure('a string')).toBeNull()
    expect(describeToolInputFailure(null)).toBeNull()
  })

  it('gives each tool its own message, so the log does not merge them', () => {
    // The error log fingerprints on the message; one shared sentence is exactly
    // why every tool's failures piled onto a single row.
    const a = describeToolInputFailure(langchainFailure({ name: 'tool_a', args: {} }))
    const b = describeToolInputFailure(langchainFailure({ name: 'tool_b', args: {} }))

    expect(a!.message).not.toBe(b!.message)
  })
})
