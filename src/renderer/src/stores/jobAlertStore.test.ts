import { beforeEach, describe, expect, it } from 'vitest'
import {
  useJobAlertStore,
  alertVariant,
  ALERT_KIND_LABEL,
  MAX_ALERTS,
} from './jobAlertStore'
import type { JobAlertKind, JobNotification } from '../../../shared/types'

/**
 * The alert store is the last mile of job reporting: the scheduler announces a
 * non-success, the shell captures it here, and `unseen` is what badges the nav
 * rail. That makes the counter load-bearing — if it drifts from the list, the
 * rail either nags about alerts that are gone or stays clean while a job is
 * broken, and the second failure mode is the one this whole path exists to fix.
 */

/**
 * Written as a Record rather than an array so the *type* enforces exhaustiveness:
 * adding a `JobAlertKind` without giving it a label or a severity fails to
 * compile here instead of rendering as a blank chip.
 */
const KIND_PRESENCE: Record<JobAlertKind, true> = {
  failure: true,
  timeout: true,
  skipped: true,
  deferred: true,
  cancelled: true,
  awaiting_approval: true,
  disabled: true,
  degraded: true,
}
const ALL_KINDS = Object.keys(KIND_PRESENCE) as JobAlertKind[]

let seq = 0
function alert(over: Partial<JobNotification> = {}): JobNotification {
  seq++
  return {
    id: `alert-${seq}`,
    priority: 'normal',
    kind: 'failure',
    title: `Failed: job ${seq}`,
    body: 'Something went wrong.',
    jobId: `job-${seq}`,
    jobName: `job ${seq}`,
    at: 1_700_000_000_000 + seq,
    ...over,
  }
}

const state = () => useJobAlertStore.getState()

beforeEach(() => {
  useJobAlertStore.setState({ alerts: [], unseen: 0 })
})

describe('alert accumulation', () => {
  it('keeps the newest alert first', () => {
    const first = alert()
    const second = alert()
    state().push(first)
    state().push(second)

    expect(state().alerts.map((a) => a.id)).toEqual([second.id, first.id])
  })

  it('counts each new alert as unseen', () => {
    state().push(alert())
    state().push(alert())

    expect(state().unseen).toBe(2)
  })

  it('bounds the list so an overnight retry loop cannot grow it without limit', () => {
    for (let i = 0; i < MAX_ALERTS + 25; i++) state().push(alert())

    expect(state().alerts).toHaveLength(MAX_ALERTS)
  })
})

describe('the badge never outlives the alerts it counts', () => {
  // Each case below produced a rail badge pointing at a banner that could not
  // account for it.
  it('does not count past the cap once pushes start evicting', () => {
    for (let i = 0; i < MAX_ALERTS + 25; i++) state().push(alert())

    expect(state().unseen).toBe(MAX_ALERTS)
    expect(state().unseen).toBeLessThanOrEqual(state().alerts.length)
  })

  it('drops the count with the alert when one is dismissed unseen', () => {
    const a = alert()
    const b = alert()
    state().push(a)
    state().push(b)

    state().dismiss(a.id)

    expect(state().alerts.map((x) => x.id)).toEqual([b.id])
    expect(state().unseen).toBe(1)
  })

  it('leaves nothing behind when the last alert is dismissed', () => {
    const a = alert()
    state().push(a)
    state().dismiss(a.id)

    expect(state().alerts).toEqual([])
    expect(state().unseen).toBe(0)
  })

  it('clears both the list and the count', () => {
    state().push(alert())
    state().push(alert())
    state().clear()

    expect(state().alerts).toEqual([])
    expect(state().unseen).toBe(0)
  })
})

describe('seen is not the same as resolved', () => {
  it('clears the badge but keeps the alerts on the banner', () => {
    state().push(alert())
    state().push(alert())

    state().markAllSeen()

    // The point of the split: looking at a failure does not fix it, so the
    // record stays until dismissed even though the rail stops nagging.
    expect(state().unseen).toBe(0)
    expect(state().alerts).toHaveLength(2)
  })

  it('badges the rail again when a new alert lands after a look', () => {
    state().push(alert())
    state().markAllSeen()
    state().push(alert())

    expect(state().unseen).toBe(1)
  })

  it('changes the array identity on push, so the view re-marks them seen', () => {
    state().push(alert())
    const before = state().alerts
    state().push(alert())

    // The Jobs view keys its markAllSeen effect on this identity rather than on
    // the length, which stops changing at the cap.
    expect(state().alerts).not.toBe(before)
  })
})

describe('severity mapping', () => {
  it('labels every alert kind', () => {
    for (const kind of ALL_KINDS) {
      expect(ALERT_KIND_LABEL[kind], `${kind} has no label`).toBeTruthy()
    }
    expect(Object.keys(ALERT_KIND_LABEL).sort()).toEqual(ALL_KINDS.sort())
  })

  it('gives every alert kind a variant', () => {
    for (const kind of ALL_KINDS) {
      expect(['error', 'warning', 'info']).toContain(alertVariant(kind))
    }
  })

  it('treats the outcomes that stop work for good as errors', () => {
    // These do not fix themselves; a retry or an approval prompt will.
    for (const kind of ['disabled', 'failure', 'timeout'] as const) {
      expect(alertVariant(kind), kind).toBe('error')
    }
  })

  it('does not let a degraded success pass as merely informational', () => {
    expect(alertVariant('degraded')).toBe('warning')
  })

  it('keeps self-correcting outcomes out of the error tier', () => {
    for (const kind of ['deferred', 'awaiting_approval'] as const) {
      expect(alertVariant(kind), kind).toBe('info')
    }
  })
})
