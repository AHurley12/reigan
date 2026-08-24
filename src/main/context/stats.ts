import type Database from 'better-sqlite3'
import { getDatabase } from '../db/database'
import { decayFacts, setStat, upsertFact } from './store'

const DAY_MS = 86_400_000
const WINDOW_DAYS = 30
const OVERDUE_FACT_THRESHOLD = 5

export interface ContextStats {
  tasksThroughput: { created: number; completed: number; open: number }
  tasksOverdue: { count: number; oldestDays: number }
  tasksLatencyDays: number | null
  jobsReliability: { runs: number; failures: number; failureRate: number }
  coldProjects: Array<{ name: string; days: number }>
}

/**
 * Aggregates the user's own activity straight out of SQL.
 *
 * These are the numbers the model is not allowed to invent. Everything the
 * digest says about how far behind the user is traces back to a row count here,
 * which is what separates "you've rescheduled this four times" from a plausible
 * sounding figure a language model produced under pressure to land a joke.
 *
 * All timestamps in this database are milliseconds (Date.now()), not seconds.
 */
export function computeStats(db: Database.Database, now = Date.now()): ContextStats {
  const windowStart = now - WINDOW_DAYS * DAY_MS

  const created = (db
    .prepare('SELECT COUNT(*) AS c FROM tasks WHERE created_at >= ?')
    .get(windowStart) as { c: number }).c

  const completed = (db
    .prepare('SELECT COUNT(*) AS c FROM tasks WHERE completed_at IS NOT NULL AND completed_at >= ?')
    .get(windowStart) as { c: number }).c

  const open = (db
    .prepare("SELECT COUNT(*) AS c FROM tasks WHERE status != 'done'")
    .get() as { c: number }).c

  const overdue = db
    .prepare(`
      SELECT COUNT(*) AS c, MIN(due_date) AS oldest
        FROM tasks
       WHERE status != 'done' AND due_date IS NOT NULL AND due_date < ?
    `)
    .get(now) as { c: number; oldest: number | null }

  const durations = (db
    .prepare(`
      SELECT (completed_at - created_at) AS d
        FROM tasks
       WHERE completed_at IS NOT NULL AND completed_at >= created_at
       ORDER BY d ASC
    `)
    .all() as Array<{ d: number }>).map((r) => r.d)

  const jobs = db
    .prepare(`
      SELECT COUNT(*) AS runs,
             SUM(CASE WHEN status IN ('failure', 'timeout') THEN 1 ELSE 0 END) AS failures
        FROM job_runs
       WHERE started_at >= ?
    `)
    .get(windowStart) as { runs: number; failures: number | null }

  const cold = (db
    .prepare(`
      SELECT name, last_modified
        FROM projects
       WHERE status IN ('dormant', 'abandoned') AND last_modified IS NOT NULL
       ORDER BY last_modified ASC
       LIMIT 5
    `)
    .all() as Array<{ name: string; last_modified: number }>)

  const failures = jobs.failures ?? 0
  const medianDuration = median(durations)

  return {
    tasksThroughput: { created, completed, open },
    tasksOverdue: {
      count: overdue.c,
      oldestDays: overdue.oldest === null ? 0 : Math.floor((now - overdue.oldest) / DAY_MS),
    },
    tasksLatencyDays: medianDuration === null ? null : Math.round(medianDuration / DAY_MS),
    jobsReliability: {
      runs: jobs.runs,
      failures,
      failureRate: jobs.runs === 0 ? 0 : failures / jobs.runs,
    },
    coldProjects: cold.map((p) => ({
      name: p.name,
      days: Math.floor((now - p.last_modified) / DAY_MS),
    })),
  }
}

/** Computes, persists, seeds threshold-tripped facts, and ages old ones. */
export function refreshStats(now = Date.now()): ContextStats {
  const stats = computeStats(getDatabase(), now)

  setStat('tasks.throughput', stats.tasksThroughput, now)
  setStat('tasks.overdue', stats.tasksOverdue, now)
  setStat('tasks.latency', { days: stats.tasksLatencyDays }, now)
  setStat('jobs.reliability', stats.jobsReliability, now)
  setStat('projects.cold', stats.coldProjects, now)

  if (stats.tasksOverdue.count > OVERDUE_FACT_THRESHOLD) {
    upsertFact(
      {
        kind: 'tendency',
        key: 'overdue-backlog',
        body: `Has ${stats.tasksOverdue.count} overdue tasks; the oldest is ${stats.tasksOverdue.oldestDays} days past due.`,
        source: 'stat',
        evidence: 'tasks table',
      },
      now,
    )
  }

  decayFacts(now)
  return stats
}

/** SQLite has no median. Averages are unusable here — see the latency test. */
function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}
