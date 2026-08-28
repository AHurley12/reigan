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

// The session-grant store is stateful by nature, so the mock is too — a
// `vi.fn()` returning a fixed value could not express "approving once changes
// the answer for the next call", which is the whole of the session policy.
const grants = new Set<string>()
vi.mock('./approval', () => ({
  requestApproval: vi.fn(async () => ({ status: 'approved' })),
  hasSessionGrant: vi.fn((id: string) => grants.has(id)),
  recordSessionGrant: vi.fn((id: string) => {
    grants.add(id)
  }),
}))
import { requestApproval } from './approval'

// The "require approval for everything" switch is read from settings at
// dispatch. Mocked so these tests state which side of it they are exercising
// rather than inheriting whatever the developer's own database says.
vi.mock('../db/queries', () => ({
  getDecodedSetting: vi.fn(() => null),
}))
import { getDecodedSetting } from '../db/queries'

/** Turns the global override off, restoring "a UI click is the approval". */
function trustUiClicks(): void {
  vi.mocked(getDecodedSetting).mockReturnValue('false')
}

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
  // Unset, which the dispatcher must read as "on" — a security default that
  // only takes effect once someone visits Settings is not a default.
  vi.mocked(getDecodedSetting).mockReturnValue(null)
  grants.clear()
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

  it('does not prompt for a UI invocation once the global override is off', async () => {
    trustUiClicks()
    registerCapability(writeCap)
    const r = await invokeCapability('test.mutate', {}, { invokedBy: 'ui' })

    // The click is the approval. Prompting here trains people to approve
    // without reading, which is what breaks the agent case.
    expect(requestApproval).not.toHaveBeenCalled()
    expect(r.ok).toBe(true)
  })

  /**
   * The default. Dispatch cannot distinguish "the user pressed Save on a
   * one-line edit" from "the user pressed Execute on a plan spanning 400
   * files" — only the risk tier can, and it calls both write-or-worse. So the
   * organiser and the shell get a second look unless the user opts out.
   */
  it('prompts for a UI invocation by default', async () => {
    registerCapability(writeCap)
    const r = await invokeCapability('test.mutate', {}, { invokedBy: 'ui' })

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(r.ok).toBe(true)
  })

  describe('dynamicRisk', () => {
    const dynamic = (): AnyCapability =>
      def({
        id: 'test.dynamic',
        risk: 'destructive',
        schema: z.object({ safe: z.boolean() }),
        dynamicRisk: (args: { safe: boolean }) => (args.safe ? 'read' : 'destructive'),
        approval: { summary: () => 'Do the risky thing' },
        handler: () => 'done',
      })

    it('skips the prompt when the arguments narrow the tier to read', async () => {
      registerCapability(dynamic())
      const r = await invokeCapability('test.dynamic', { safe: true }, { invokedBy: 'agent' })

      expect(requestApproval).not.toHaveBeenCalled()
      expect(r.ok).toBe(true)
    })

    it('still prompts when the arguments keep it destructive', async () => {
      registerCapability(dynamic())
      await invokeCapability('test.dynamic', { safe: false }, { invokedBy: 'agent' })

      expect(requestApproval).toHaveBeenCalledOnce()
    })

    it('falls back to the declared tier if the risk function throws', async () => {
      registerCapability(
        def({
          id: 'test.throws',
          risk: 'destructive',
          dynamicRisk: () => {
            throw new Error('bad parse')
          },
          approval: { summary: () => 'x' },
          handler: () => 'done',
        })
      )
      await invokeCapability('test.throws', {}, { invokedBy: 'agent' })

      // Failing open here would let a bug in a classifier silently disable
      // the prompt, which is the one direction this must never fail in.
      expect(requestApproval).toHaveBeenCalledOnce()
    })

    it('requires an approval spec even when the static tier is read', () => {
      expect(() =>
        registerCapability(
          def({ id: 'test.noSpec', risk: 'read', dynamicRisk: () => 'destructive' })
        )
      ).toThrow(/approval spec/)
    })
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

/**
 * The approval axis that is independent of the risk tier.
 *
 * Web search is a `network` read — it changes nothing the user owns — but it
 * spends metered credits and sends the user's words to a third party. These
 * tests pin down that the prompt comes from the policy, without the capability
 * having to lie about its tier to get one.
 */
describe('approvalPolicy', () => {
  const searchLike = (overrides: Partial<AnyCapability> = {}): AnyCapability =>
    def({
      id: 'web.search',
      risk: 'network',
      approvalPolicy: 'session',
      approval: { summary: () => 'Search the web' },
      ...overrides,
    })

  it('requires an approval spec, exactly as the write tiers do', () => {
    expect(() =>
      registerCapability(def({ id: 'web.nospec', risk: 'network', approvalPolicy: 'session' }))
    ).toThrow(/must also declare an approval spec/)
  })

  it('prompts for a network capability that the tier alone would let through', async () => {
    registerCapability(searchLike())

    await invokeCapability('web.search', {}, { invokedBy: 'agent' })

    expect(requestApproval).toHaveBeenCalledTimes(1)
  })

  it('keeps the honest tier on the card rather than claiming a write', async () => {
    registerCapability(searchLike())

    await invokeCapability('web.search', {}, { invokedBy: 'agent' })

    expect(vi.mocked(requestApproval).mock.calls[0][0].risk).toBe('network')
  })

  describe("policy: 'session'", () => {
    it('prompts once, then runs without asking again', async () => {
      registerCapability(searchLike())

      const first = await invokeCapability('web.search', {}, { invokedBy: 'agent' })
      const second = await invokeCapability('web.search', {}, { invokedBy: 'agent' })
      const third = await invokeCapability('web.search', {}, { invokedBy: 'agent' })

      expect(first.ok && second.ok && third.ok).toBe(true)
      expect(requestApproval).toHaveBeenCalledTimes(1)
    })

    it('does not bank a grant when the user denied', async () => {
      vi.mocked(requestApproval).mockResolvedValue({ status: 'denied', reason: 'No.' })
      registerCapability(searchLike())

      const first = await invokeCapability('web.search', {}, { invokedBy: 'agent' })
      const second = await invokeCapability('web.search', {}, { invokedBy: 'agent' })

      expect(first.ok).toBe(false)
      expect(second.ok).toBe(false)
      // A denial must never be mistaken for an answer covering the conversation.
      expect(requestApproval).toHaveBeenCalledTimes(2)
    })

    it('grants only the capability approved, not its whole namespace', async () => {
      registerCapability(searchLike())
      registerCapability(searchLike({ id: 'web.extract' }))

      await invokeCapability('web.search', {}, { invokedBy: 'agent' })
      await invokeCapability('web.extract', {}, { invokedBy: 'agent' })

      expect(requestApproval).toHaveBeenCalledTimes(2)
    })
  })

  describe("policy: 'always'", () => {
    it('prompts on every call, however many times it is used', async () => {
      registerCapability(searchLike({ id: 'web.crawl', approvalPolicy: 'always' }))

      await invokeCapability('web.crawl', {}, { invokedBy: 'agent' })
      await invokeCapability('web.crawl', {}, { invokedBy: 'agent' })
      await invokeCapability('web.crawl', {}, { invokedBy: 'agent' })

      expect(requestApproval).toHaveBeenCalledTimes(3)
    })

    it('is never satisfied by a session grant on the same capability', async () => {
      registerCapability(searchLike({ id: 'web.crawl', approvalPolicy: 'always' }))
      grants.add('web.crawl')

      await invokeCapability('web.crawl', {}, { invokedBy: 'agent' })

      expect(requestApproval).toHaveBeenCalledTimes(1)
    })
  })

  it('reports the requirement in the capability list, so the UI can show it', () => {
    registerCapability(searchLike())

    const info = listCapabilities().find((c) => c.id === 'web.search')
    expect(info?.requiresApproval).toBe(true)
    expect(info?.risk).toBe('network')
  })

  it('leaves an ordinary network capability entirely ungated', async () => {
    registerCapability(def({ id: 'test.plain', risk: 'network' }))

    await invokeCapability('test.plain', {}, { invokedBy: 'agent' })

    expect(requestApproval).not.toHaveBeenCalled()
  })
})
