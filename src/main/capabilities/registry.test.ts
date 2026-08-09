import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  clearRegistry,
  invokeCapability,
  listCapabilities,
  listModelVisibleCapabilities,
  registerCapability,
} from './registry'
import type { AnyCapability } from './types'

vi.mock('./approval', () => ({
  requestApproval: vi.fn(async () => ({ status: 'approved' })),
}))
import { requestApproval } from './approval'

const noop = { schema: z.object({}), handler: () => 'ok' }

function def(overrides: Partial<AnyCapability>): AnyCapability {
  return {
    id: 'test.thing',
    title: 'Test',
    description: 'A test capability',
    risk: 'read',
    ...noop,
    ...overrides,
  } as AnyCapability
}

beforeEach(() => {
  clearRegistry()
  vi.mocked(requestApproval).mockClear()
  vi.mocked(requestApproval).mockResolvedValue({ status: 'approved' })
})

describe('registration rules', () => {
  it('rejects a duplicate id', () => {
    registerCapability(def({ id: 'test.one' }))
    expect(() => registerCapability(def({ id: 'test.one' }))).toThrow(/collision/)
  })

  it('rejects an id that is not dotted camelCase', () => {
    expect(() => registerCapability(def({ id: 'notdotted' }))).toThrow(/dotted camelCase/)
    expect(() => registerCapability(def({ id: 'Bad.Id' }))).toThrow(/dotted camelCase/)
  })

  it('refuses a write capability with no approval spec', () => {
    expect(() => registerCapability(def({ id: 'test.write', risk: 'write' }))).toThrow(
      /must declare an approval spec/
    )
  })

  it('refuses a destructive capability with no approval spec', () => {
    expect(() => registerCapability(def({ id: 'test.nuke', risk: 'destructive' }))).toThrow(
      /must declare an approval spec/
    )
  })

  it('refuses a uiOnly capability with no stated reason', () => {
    expect(() => registerCapability(def({ id: 'test.hidden', uiOnly: true }))).toThrow(
      /uiOnlyReason/
    )
  })
})

describe('uiOnly is enforced, not merely declared', () => {
  const hidden = def({
    id: 'usage.getSessions',
    uiOnly: true,
    uiOnlyReason: 'Returns raw window titles, which must never enter model context.',
    handler: () => 'raw window titles',
  })
  const visible = def({ id: 'usage.getSummary', handler: () => 'aggregates' })

  it('excludes uiOnly capabilities from the model-visible list', () => {
    registerCapability(hidden)
    registerCapability(visible)

    const ids = listModelVisibleCapabilities().map((c) => c.id)
    expect(ids).toContain('usage.getSummary')
    expect(ids).not.toContain('usage.getSessions')
  })

  it('refuses agent dispatch of a uiOnly capability even if a tool leaked', () => {
    registerCapability(hidden)
    return invokeCapability('usage.getSessions', {}, { invokedBy: 'agent' }).then((r) => {
      expect(r.ok).toBe(false)
      expect(r.errorCode).toBe('denied')
      expect(r.error).toMatch(/not available to the assistant/)
    })
  })

  it('still allows the UI to call it', async () => {
    registerCapability(hidden)
    const r = await invokeCapability('usage.getSessions', {}, { invokedBy: 'ui' })
    expect(r.ok).toBe(true)
    expect(r.result).toBe('raw window titles')
  })

  it('lists the reason so the exclusion set is auditable', () => {
    registerCapability(hidden)
    const info = listCapabilities().find((c) => c.id === 'usage.getSessions')
    expect(info?.uiOnly).toBe(true)
    expect(info?.uiOnlyReason).toMatch(/window titles/)
  })
})

describe('argument validation', () => {
  it('rejects arguments that fail the schema, with a usable message', async () => {
    registerCapability(
      def({
        id: 'test.needsTitle',
        schema: z.object({ title: z.string().min(1) }),
        handler: (a: { title: string }) => a.title,
      })
    )

    const r = await invokeCapability('test.needsTitle', { title: 123 }, { invokedBy: 'agent' })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('invalid_args')
    expect(r.error).toMatch(/title/)
  })

  it('reports an unknown capability rather than throwing', async () => {
    const r = await invokeCapability('nope.missing', {}, { invokedBy: 'agent' })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('not_found')
  })
})

describe('approval enforcement by tier', () => {
  const writeCap = def({
    id: 'test.mutate',
    risk: 'write',
    approval: { summary: () => 'Change the thing' },
    handler: () => 'mutated',
  })

  it('prompts for a write capability invoked by the agent', async () => {
    registerCapability(writeCap)
    const r = await invokeCapability('test.mutate', {}, { invokedBy: 'agent' })

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(r.ok).toBe(true)
  })

  it('does not prompt when the user invoked it from the UI', async () => {
    registerCapability(writeCap)
    const r = await invokeCapability('test.mutate', {}, { invokedBy: 'ui' })

    // The click is the approval. Prompting here trains people to approve
    // without reading, which is what breaks the agent case.
    expect(requestApproval).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })

  it('never prompts for a read capability', async () => {
    registerCapability(def({ id: 'test.read', handler: () => 'data' }))
    await invokeCapability('test.read', {}, { invokedBy: 'agent' })
    expect(requestApproval).not.toHaveBeenCalled()
  })

  it('does not run the handler when approval is denied', async () => {
    const handler = vi.fn(() => 'should not happen')
    registerCapability(def({ ...writeCap, id: 'test.denied', handler }))
    vi.mocked(requestApproval).mockResolvedValue({ status: 'denied', reason: 'The user said no' })

    const r = await invokeCapability('test.denied', {}, { invokedBy: 'agent' })

    expect(handler).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('denied')
  })

  it('parks a job-sourced write instead of running or denying it', async () => {
    const handler = vi.fn(() => 'should not happen yet')
    registerCapability(def({ ...writeCap, id: 'test.queued', handler }))
    vi.mocked(requestApproval).mockResolvedValue({ status: 'queued', approvalId: 'appr-1' })

    const r = await invokeCapability('test.queued', {}, { invokedBy: 'job' })

    // The 3am case: nothing is written, nothing is silently lost, and the run
    // has an id to resume from once the user approves.
    expect(handler).not.toHaveBeenCalled()
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('awaiting_approval')
    expect(r.awaitingApprovalId).toBe('appr-1')
  })

  it('proceeds when a diff builder throws, rather than blocking the action', async () => {
    registerCapability(
      def({
        ...writeCap,
        id: 'test.baddiff',
        approval: {
          summary: () => 'Change the thing',
          diff: () => {
            throw new Error('diff blew up')
          },
        },
      })
    )

    const r = await invokeCapability('test.baddiff', {}, { invokedBy: 'agent' })
    expect(r.ok).toBe(true)
    expect(vi.mocked(requestApproval).mock.calls[0][0].diff).toBeNull()
  })
})

describe('handler failures', () => {
  it('returns an error the model can report instead of throwing', async () => {
    registerCapability(
      def({
        id: 'test.explodes',
        handler: () => {
          throw new Error('upstream 503')
        },
      })
    )

    const r = await invokeCapability('test.explodes', {}, { invokedBy: 'agent' })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('handler_failed')
    expect(r.error).toMatch(/upstream 503/)
  })
})
