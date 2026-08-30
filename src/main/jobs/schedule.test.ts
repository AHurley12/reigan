import { describe, expect, it } from 'vitest'
import {
  describeSchedule,
  formatRelative,
  MAX_CATCH_UP_OCCURRENCES,
  missedOccurrences,
  nextOccurrence,
  ScheduleError,
  validateSchedule,
} from './schedule'

/** Local-time constructor, so tests read as wall-clock times. TZ is pinned in vitest.config.ts. */
const local = (y: number, m: number, d: number, h = 0, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0).getTime()

describe('interval', () => {
  it('advances by the given number of minutes', () => {
    const start = local(2026, 6, 1, 12, 0)
    expect(nextOccurrence('interval', '15', start)).toBe(start + 15 * 60_000)
  })

  it('rejects a non-positive interval', () => {
    expect(() => nextOccurrence('interval', '0', Date.now())).toThrow(ScheduleError)
    expect(() => nextOccurrence('interval', '-5', Date.now())).toThrow(ScheduleError)
    expect(() => nextOccurrence('interval', 'soon', Date.now())).toThrow(ScheduleError)
  })
})

describe('daily_at', () => {
  it('fires at the right local time', () => {
    const from = local(2026, 6, 1, 8, 0)
    const next = nextOccurrence('daily_at', '09:30', from)!
    expect(next).toBe(local(2026, 6, 1, 9, 30))
  })

  it('rolls to tomorrow once today has passed', () => {
    const from = local(2026, 6, 1, 10, 0)
    expect(nextOccurrence('daily_at', '09:30', from)).toBe(local(2026, 6, 2, 9, 30))
  })

  it('is strictly forward — never returns the instant it was given', () => {
    const exact = local(2026, 6, 1, 9, 30)
    expect(nextOccurrence('daily_at', '09:30', exact)).toBe(local(2026, 6, 2, 9, 30))
  })

  it('rejects a malformed time', () => {
    expect(() => nextOccurrence('daily_at', '25:00', 0)).toThrow(ScheduleError)
    expect(() => nextOccurrence('daily_at', '9am', 0)).toThrow(ScheduleError)
  })
})

describe('DST — the case that silently double-runs or skips a daily job', () => {
  it('fires exactly once on the spring-forward day, even for a time that does not exist', () => {
    // 8 March 2026: 02:00 EST jumps to 03:00 EDT. A 02:30 job has no 02:30.
    const from = local(2026, 3, 7, 12, 0)
    const first = nextOccurrence('daily_at', '02:30', from)!
    const second = nextOccurrence('daily_at', '02:30', first)!

    // It fires (as 03:30 EDT, the first real instant at or after the target)…
    expect(new Date(first).getDate()).toBe(8)
    // …and exactly once: the following fire is the next calendar day.
    expect(new Date(second).getDate()).toBe(9)
    expect(second).toBeGreaterThan(first)
  })

  it('does not double-run on the fall-back day when the wall-clock time occurs twice', () => {
    // 1 November 2026: 02:00 EDT falls back to 01:00 EST, so 01:30 happens twice.
    const from = local(2026, 10, 31, 12, 0)
    const first = nextOccurrence('daily_at', '01:30', from)!
    const second = nextOccurrence('daily_at', '01:30', first)!

    expect(new Date(first).getDate()).toBe(1)
    // The second 01:30 (EST, one hour later) must NOT be scheduled — the job
    // already ran that day.
    expect(new Date(second).getDate()).toBe(2)
    expect(second - first).toBeGreaterThan(23 * 3_600_000)
  })

  it('yields exactly one occurrence per day across a spring-forward week', () => {
    const start = local(2026, 3, 5, 0, 0)
    const end = local(2026, 3, 12, 0, 0)
    const { occurrences } = missedOccurrences('daily_at', '09:00', start, end)

    expect(occurrences).toHaveLength(7)
    const days = occurrences.map((o) => new Date(o).getDate())
    expect(days).toEqual([5, 6, 7, 8, 9, 10, 11])
    // Every one lands at 09:00 local despite the 23-hour day in the middle.
    for (const o of occurrences) expect(new Date(o).getHours()).toBe(9)
  })

  it('yields exactly one occurrence per day across a fall-back week', () => {
    const start = local(2026, 10, 29, 0, 0)
    const end = local(2026, 11, 5, 0, 0)
    const { occurrences } = missedOccurrences('daily_at', '09:00', start, end)

    expect(occurrences).toHaveLength(7)
    for (const o of occurrences) expect(new Date(o).getHours()).toBe(9)
  })

  it('keeps a weekly job on its weekday across a DST boundary', () => {
    const from = local(2026, 3, 2, 0, 0)
    let cursor = from
    for (let i = 0; i < 4; i++) {
      cursor = nextOccurrence('weekly_on', 'MON@09:00', cursor)!
      expect(new Date(cursor).getDay()).toBe(1)
      expect(new Date(cursor).getHours()).toBe(9)
    }
  })
})

describe('weekly_on', () => {
  it('finds the next listed day', () => {
    // 1 June 2026 is a Monday.
    const monday = local(2026, 6, 1, 10, 0)
    const next = nextOccurrence('weekly_on', 'MON,THU@14:00', monday)!
    expect(new Date(next).getDay()).toBe(1)
    expect(new Date(next).getHours()).toBe(14)

    const after = nextOccurrence('weekly_on', 'MON,THU@14:00', next)!
    expect(new Date(after).getDay()).toBe(4)
  })

  it('rejects an unknown day name', () => {
    expect(() => nextOccurrence('weekly_on', 'FUNDAY@10:00', 0)).toThrow(ScheduleError)
  })

  it('rejects a missing time', () => {
    expect(() => nextOccurrence('weekly_on', 'MON', 0)).toThrow(ScheduleError)
  })
})

describe('cron', () => {
  it('parses a standard expression in local time', () => {
    const from = local(2026, 6, 1, 0, 0)
    const next = nextOccurrence('cron', '0 3 * * *', from)!
    expect(new Date(next).getHours()).toBe(3)
  })

  it('throws on a malformed expression', () => {
    expect(() => nextOccurrence('cron', 'not a cron', Date.now())).toThrow()
  })
})

describe('manual', () => {
  it('never fires on its own', () => {
    expect(nextOccurrence('manual', '', Date.now())).toBeNull()
    expect(missedOccurrences('manual', '', 0, Date.now()).occurrences).toEqual([])
  })
})

describe('missedOccurrences — the boot catch-up input', () => {
  it('enumerates every occurrence missed while the app was closed', () => {
    const from = local(2026, 6, 1, 12, 0)
    const until = local(2026, 6, 1, 13, 0)
    const { occurrences, truncated } = missedOccurrences('interval', '15', from, until)

    expect(occurrences).toHaveLength(4)
    expect(truncated).toBe(false)
    expect(occurrences[0]).toBe(from + 15 * 60_000)
    expect(occurrences[3]).toBe(until)
  })

  it('excludes the lower bound and includes the upper', () => {
    const from = local(2026, 6, 1, 12, 0)
    const until = local(2026, 6, 1, 12, 30)
    const { occurrences } = missedOccurrences('interval', '15', from, until)

    expect(occurrences).not.toContain(from)
    expect(occurrences).toContain(until)
  })

  it('returns nothing when nothing was missed', () => {
    const from = local(2026, 6, 1, 12, 0)
    expect(missedOccurrences('daily_at', '09:00', from, from + 60_000).occurrences).toEqual([])
  })

  it('caps a long absence and says so', () => {
    // A fortnight offline with a 15-minute job: ~1,340 occurrences.
    const from = local(2026, 6, 1, 0, 0)
    const until = local(2026, 6, 15, 0, 0)
    const { occurrences, truncated } = missedOccurrences('interval', '15', from, until)

    expect(occurrences).toHaveLength(MAX_CATCH_UP_OCCURRENCES)
    expect(truncated).toBe(true)
  })

  it('does not report truncation when the cap lands exactly on the last occurrence', () => {
    const from = local(2026, 6, 1, 0, 0)
    const until = from + MAX_CATCH_UP_OCCURRENCES * 15 * 60_000
    const { occurrences, truncated } = missedOccurrences('interval', '15', from, until)

    expect(occurrences).toHaveLength(MAX_CATCH_UP_OCCURRENCES)
    expect(truncated).toBe(false)
  })
})

describe('validateSchedule', () => {
  it('accepts every supported kind', () => {
    expect(() => validateSchedule('interval', '30')).not.toThrow()
    expect(() => validateSchedule('daily_at', '08:00')).not.toThrow()
    expect(() => validateSchedule('weekly_on', 'MON,FRI@17:00')).not.toThrow()
    expect(() => validateSchedule('cron', '0 3 * * 1')).not.toThrow()
    expect(() => validateSchedule('manual', '')).not.toThrow()
  })

  it('rejects a bad expression at save time rather than at fire time', () => {
    expect(() => validateSchedule('daily_at', 'noon')).toThrow()
    expect(() => validateSchedule('interval', '0')).toThrow()
  })
})

describe('describeSchedule — the jobs table must not show raw cron', () => {
  it('renders each kind in plain language', () => {
    expect(describeSchedule('interval', '15')).toBe('Every 15 minutes')
    expect(describeSchedule('interval', '60')).toBe('Hourly')
    expect(describeSchedule('interval', '1440')).toBe('Daily')
    expect(describeSchedule('interval', '120')).toBe('Every 2 hours')
    expect(describeSchedule('daily_at', '09:00')).toBe('Daily at 09:00')
    expect(describeSchedule('weekly_on', 'MON@09:00')).toBe('Mondays at 09:00')
    expect(describeSchedule('weekly_on', 'MON,THU@14:00')).toBe('Mon and Thu at 14:00')
    expect(describeSchedule('manual', '')).toBe('Manual only')
  })

  it('translates the common cron shapes', () => {
    expect(describeSchedule('cron', '0 3 * * *')).toBe('Daily at 03:00')
    expect(describeSchedule('cron', '30 9 * * 1')).toBe('Mondays at 09:30')
    expect(describeSchedule('cron', '0 4 1 * *')).toBe('Monthly on day 1 at 04:00')
    expect(describeSchedule('cron', '15 * * * *')).toBe('Hourly at :15')
  })

  it('still renders a row whose schedule no longer parses', () => {
    // That row is exactly the one the user has come to the jobs view to fix.
    expect(describeSchedule('daily_at', 'garbage')).toMatch(/Invalid schedule/)
  })
})

describe('formatRelative', () => {
  const now = local(2026, 6, 1, 12, 0)

  it('reads naturally in both directions', () => {
    expect(formatRelative(now + 4 * 60_000, now)).toBe('in 4 minutes')
    expect(formatRelative(now + 60_000, now)).toBe('in 1 minute')
    expect(formatRelative(now + 3 * 3_600_000, now)).toBe('in 3 hours')
    expect(formatRelative(now + 2 * 86_400_000, now)).toBe('in 2 days')
    expect(formatRelative(now - 3 * 3_600_000, now)).toBe('3 hours ago')
  })

  it('handles the sub-minute edges', () => {
    expect(formatRelative(now + 5_000, now)).toBe('in under a minute')
    expect(formatRelative(now - 5_000, now)).toBe('just now')
  })
})
