import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../capabilities/approval', () => ({
  requestApproval: vi.fn(async () => ({ status: 'approved' })),
}))

import { withPermission } from './permission'
import { requestApproval } from '../../capabilities/approval'

/**
 * These tools (mail, calendar, settings, system) used to gate on
 * `agents/permissionGate`, which sent `agent:permission-request` — a channel no
 * preload or renderer ever listened on. The send went nowhere, the promise sat
 * for two minutes, and the timeout was reported to the user as *their* denial:
 * "Not done — the user denied permission for: Save a draft email to …", with no
 * card ever shown.
 *
 * Two properties keep that from coming back, and both are asserted below:
 * approval is requested through the one framework that has a live UI, and an
 * unanswered prompt never claims the user decided anything.
 */

const SUMMARY = 'Save a draft email to sam@example.com: "Q3 numbers"'

beforeEach(() => {
  vi.mocked(requestApproval).mockClear()
  vi.mocked(requestApproval).mockResolvedValue({ status: 'approved' })
})

describe('withPermission', () => {
  it('runs the action and returns its result once approved', async () => {
    const result = await withPermission('draft_email', SUMMARY, async () => 'Draft created.')

    expect(result).toBe('Draft created.')
  })

  it('requests approval as an agent-sourced write named for the tool', async () => {
    await withPermission('draft_email', SUMMARY, async () => 'Draft created.', 'body text')

    expect(requestApproval).toHaveBeenCalledOnce()
    expect(vi.mocked(requestApproval).mock.calls[0][0]).toMatchObject({
      capabilityId: 'draft_email',
      risk: 'write',
      summary: SUMMARY,
      detail: 'body text',
      requestedBy: 'agent',
    })
  })

  it('does not run the action when the user denies', async () => {
    vi.mocked(requestApproval).mockResolvedValue({
      status: 'denied',
      reason: `The user denied permission for: ${SUMMARY}`,
    })
    const action = vi.fn(async () => 'Draft created.')

    const result = await withPermission('draft_email', SUMMARY, action)

    expect(action).not.toHaveBeenCalled()
    expect(result).toMatch(/denied/i)
  })

  it('does not blame the user when the prompt goes unanswered', async () => {
    // The original bug. A timeout must read as a timeout: the action still must
    // not run, but reporting it as the user's denial is what hid a dead IPC
    // channel through an entire migration.
    vi.mocked(requestApproval).mockResolvedValue({
      status: 'expired',
      reason: `No response to the approval prompt for: ${SUMMARY}`,
    })
    const action = vi.fn(async () => 'Draft created.')

    const result = await withPermission('draft_email', SUMMARY, action)

    expect(action).not.toHaveBeenCalled()
    expect(result).not.toMatch(/denied/i)
  })

  it('does not run the action while an approval is still queued', async () => {
    vi.mocked(requestApproval).mockResolvedValue({ status: 'queued', approvalId: 'a1' })
    const action = vi.fn(async () => 'Draft created.')

    const result = await withPermission('draft_email', SUMMARY, action)

    expect(action).not.toHaveBeenCalled()
    expect(result).toMatch(/approval/i)
  })
})
