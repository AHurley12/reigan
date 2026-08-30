import { CronExpressionParser } from 'cron-parser'

/**
 * Schedule arithmetic. Deliberately pure — no database, no Electron, no clock of
 * its own — because this is where the subtle bugs live and it needs to be
 * testable directly.
 *
 * Two invariants hold everywhere in this file:
 *
 *  1. Every timestamp crossing the boundary is UTC epoch milliseconds. Local
 *     time exists only *inside* the calculations, where a `daily_at` job has to
 *     mean 9am to the person sitting at the machine, not 9am UTC.
 *
 *  2. `nextOccurrence(..., after)` returns a time strictly greater than `after`.
 *     This is what stops a `daily_at` job double-firing when the clocks go back
 *     and the local wall-clock time it wants occurs twice in one night.
 */

export type ScheduleKind = 'interval' | 'cron' | 'daily_at' | 'weekly_on' | 'manual'
export type CatchUpPolicy = 'run_once' | 'run_all' | 'skip'

/**
 * Ceiling on occurrences replayed by a `run_all` catch-up. A laptop closed over
 * a two-week holiday would otherwise queue ~1,300 runs of a 15-minute job on the
 * next boot and spend the morning grinding through them.
 */
export const MAX_CATCH_UP_OCCURRENCES = 50

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const
const SHORT_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const FULL_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

const formatTime = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

export class ScheduleError extends Error {}

/**
 * Next fire time strictly after `after`, or null for a schedule that never fires
 * on its own.
 */
export function nextOccurrence(kind: ScheduleKind, expr: string, after: number): number | null {
  switch (kind) {
    case 'manual':
      return null

    case 'interval': {
      const minutes = parseIntervalMinutes(expr)
      return after + minutes * 60_000
    }

    case 'cron': {
      // cron-parser works in the host's local timezone by default, which is what
      // a desktop user means by "3am".
      const iter = CronExpressionParser.parse(expr, { currentDate: new Date(after) })
      return iter.next().getTime()
    }

    case 'daily_at': {
      const { hour, minute } = parseTimeOfDay(expr)
      return nextLocalWallClock(after, (d) => {
        d.setHours(hour, minute, 0, 0)
      })
    }

    case 'weekly_on': {
      const { days, hour, minute } = parseWeeklyExpr(expr)
      // Walk forward a day at a time rather than computing an offset: arithmetic
      // on epoch ms breaks across a DST boundary, where a "day" is 23 or 25 hours.
      let cursor = after
      for (let i = 0; i <= 8; i++) {
        const candidate = nextLocalWallClock(cursor, (d) => {
          d.setHours(hour, minute, 0, 0)
        })
        if (candidate === null) return null
        if (days.includes(new Date(candidate).getDay())) return candidate
        cursor = candidate
      }
      return null
    }

    default:
      throw new ScheduleError(`Unknown schedule kind: ${kind}`)
  }
}

/**
 * Finds the next local wall-clock time matching `set`, strictly after `after`.
 *
 * The loop is the DST guard. On the spring-forward day a 02:30 job has no 02:30
 * to run at, and `setHours(2, 30)` silently produces 03:30 — fine, it fires once.
 * On the autumn day 01:30 exists twice; `setHours` yields the *first*, which may
 * be at or before `after` if we already ran then. Advancing a calendar day and
 * retrying guarantees forward progress in both directions without ever emitting
 * the same instant twice.
 */
function nextLocalWallClock(after: number, set: (d: Date) => void): number | null {
  const d = new Date(after)
  for (let i = 0; i <= 400; i++) {
    const candidate = new Date(d)
    set(candidate)
    if (candidate.getTime() > after) return candidate.getTime()
    d.setDate(d.getDate() + 1)
  }
  return null
}

/**
 * Occurrences in the half-open window `(from, until]` — what was missed while
 * the app was closed.
 *
 * Capped at `MAX_CATCH_UP_OCCURRENCES`; `truncated` reports whether the cap bit,
 * so the caller can log it honestly rather than pretending it replayed everything.
 */
export function missedOccurrences(
  kind: ScheduleKind,
  expr: string,
  from: number,
  until: number
): { occurrences: number[]; truncated: boolean } {
  if (kind === 'manual') return { occurrences: [], truncated: false }

  const occurrences: number[] = []
  let cursor = from

  while (occurrences.length < MAX_CATCH_UP_OCCURRENCES) {
    const next = nextOccurrence(kind, expr, cursor)
    if (next === null || next > until) {
      return { occurrences, truncated: false }
    }
    occurrences.push(next)
    cursor = next
  }

  // Hit the cap — check whether anything remains beyond it.
  const following = nextOccurrence(kind, expr, cursor)
  return { occurrences, truncated: following !== null && following <= until }
}

// ── Expression parsing ──

function parseIntervalMinutes(expr: string): number {
  const minutes = Number(expr)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new ScheduleError(`Interval schedule needs a positive number of minutes, got "${expr}".`)
  }
  return minutes
}

/** "09:30" → { hour: 9, minute: 30 } */
function parseTimeOfDay(expr: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(expr.trim())
  if (!match) throw new ScheduleError(`Expected a time like "09:30", got "${expr}".`)

  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) throw new ScheduleError(`"${expr}" is not a valid time of day.`)
  return { hour, minute }
}

/** "MON,THU@14:00" → { days: [1, 4], hour: 14, minute: 0 } */
function parseWeeklyExpr(expr: string): { days: number[]; hour: number; minute: number } {
  const [dayPart, timePart] = expr.split('@')
  if (!dayPart || !timePart) {
    throw new ScheduleError(`Expected a weekly schedule like "MON,THU@14:00", got "${expr}".`)
  }

  const days = dayPart
    .split(',')
    .map((d) => d.trim().toUpperCase())
    .map((d) => {
      const index = DAY_NAMES.indexOf(d as (typeof DAY_NAMES)[number])
      if (index === -1) throw new ScheduleError(`"${d}" is not a day name (use MON, TUE, ...).`)
      return index
    })

  if (days.length === 0) throw new ScheduleError('A weekly schedule needs at least one day.')
  return { days, ...parseTimeOfDay(timePart) }
}

/** Throws if the expression is unusable, so a bad schedule is rejected at save time. */
export function validateSchedule(kind: ScheduleKind, expr: string): void {
  if (kind === 'manual') return
  const probe = nextOccurrence(kind, expr, Date.now())
  if (probe === null) throw new ScheduleError(`Schedule "${kind}:${expr}" will never fire.`)
}

// ── Presentation ──

/**
 * Human-readable schedule text for the jobs table. The UI shows this instead of
 * a raw cron string — "0 3 * * 1" tells you nothing at a glance when you are
 * trying to work out why a job did not run.
 */
export function describeSchedule(kind: ScheduleKind, expr: string): string {
  try {
    switch (kind) {
      case 'manual':
        return 'Manual only'

      case 'interval': {
        const minutes = parseIntervalMinutes(expr)
        if (minutes === 1) return 'Every minute'
        if (minutes < 60) return `Every ${minutes} minutes`
        if (minutes === 60) return 'Hourly'
        if (minutes % 1440 === 0) {
          const days = minutes / 1440
          return days === 1 ? 'Daily' : `Every ${days} days`
        }
        if (minutes % 60 === 0) return `Every ${minutes / 60} hours`
        return `Every ${minutes} minutes`
      }

      case 'daily_at': {
        // Parsed rather than interpolated: `Daily at garbage` would otherwise
        // render as though the schedule were fine.
        const { hour, minute } = parseTimeOfDay(expr)
        return `Daily at ${formatTime(hour, minute)}`
      }

      case 'weekly_on': {
        const { days, hour, minute } = parseWeeklyExpr(expr)
        const time = formatTime(hour, minute)

        // A single day reads better in full and pluralised ("Mondays at 09:00");
        // a list reads better abbreviated ("Mon, Wed and Fri at 09:00").
        if (days.length === 1) return `${FULL_DAY_NAMES[days[0]]}s at ${time}`

        const labels = days.map((d) => SHORT_DAY_NAMES[d])
        const last = labels.pop()
        return `${labels.join(', ')} and ${last} at ${time}`
      }

      case 'cron':
        return describeCron(expr)

      default:
        return `${kind}: ${expr}`
    }
  } catch {
    // A schedule that no longer parses still has to render in the table — that
    // row is precisely the one the user needs to find and fix.
    return `Invalid schedule (${expr})`
  }
}

/**
 * Best-effort plain English for the common cron shapes, falling back to the raw
 * expression with the next fire time appended. Not a general cron translator;
 * covering every expression is not worth the surface area.
 */
function describeCron(expr: string): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length === 5) {
    const [min, hour, dom, month, dow] = fields
    const isNum = (s: string) => /^\d+$/.test(s)
    const time = isNum(min) && isNum(hour)
      ? `${String(Number(hour)).padStart(2, '0')}:${String(Number(min)).padStart(2, '0')}`
      : null

    if (time && dom === '*' && month === '*' && dow === '*') return `Daily at ${time}`
    if (time && dom === '*' && month === '*' && isNum(dow)) {
      return `${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][Number(dow)]} at ${time}`
    }
    if (time && isNum(dom) && month === '*' && dow === '*') {
      return `Monthly on day ${Number(dom)} at ${time}`
    }
    if (isNum(min) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
      return `Hourly at :${String(Number(min)).padStart(2, '0')}`
    }
  }

  const next = nextOccurrence('cron', expr, Date.now())
  return next ? `${expr} (next: ${new Date(next).toLocaleString()})` : expr
}

/** "in 4 minutes" / "3 hours ago" — the jobs table shows next run as relative time. */
export function formatRelative(target: number, now = Date.now()): string {
  const delta = target - now
  const abs = Math.abs(delta)
  const past = delta < 0

  const units: Array<[number, string]> = [
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
  ]

  if (abs < 60_000) return past ? 'just now' : 'in under a minute'

  let value = Math.round(abs / 60_000)
  let unit = 'minute'
  for (const [ms, name] of units) {
    if (abs >= ms) {
      value = Math.round(abs / ms)
      unit = name
    }
  }

  const plural = value === 1 ? unit : `${unit}s`
  return past ? `${value} ${plural} ago` : `in ${value} ${plural}`
}
