import { beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

process.env.REIGAN_TEST_USERDATA = mkdtempSync(join(tmpdir(), 'reigan-stats-'))

const { getDatabase } = await import('../db/database')
const { computeStats, refreshStats } = await import('./stats')
const store = await import('./store')

const NOW = 1_700_000_000_000
const DAY = 86_400_000

beforeEach(() => {
  getDatabase().exec(`
    DELETE FROM tasks; DELETE FROM job_runs; DELETE FROM jobs;
    DELETE FROM projects; DELETE FROM context_facts; DELETE FROM context_stats;
  `)
})

function addTask(p: { id: string; status?: string; created?: number; completed?: number | null; due?: number | null }) {
  getDatabase()
    .prepare(`
      INSERT INTO tasks (id, title, status, priority, due_date, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, 'medium', ?, ?, ?, ?)
    `)
    .run(p.id, `Task ${p.id}`, p.status ?? 'backlog', p.due ?? null, p.created ?? NOW, p.created ?? NOW, p.completed ?? null)
}

describe('computeStats — tasks', () => {
  it('counts creations and completions inside the 30-day window only', () => {
    addTask({ id: 'recent', created: NOW - 5 * DAY })
    addTask({ id: 'old', created: NOW - 40 * DAY })
    addTask({ id: 'done-recent', status: 'done', created: NOW - 10 * DAY, completed: NOW - 2 * DAY })

    const s = computeStats(getDatabase(), NOW)

    expect(s.tasksThroughput.created).toBe(2)
    expect(s.tasksThroughput.completed).toBe(1)
    expect(s.tasksThroughput.open).toBe(2)
  })

  it('reports overdue count and the age of the oldest', () => {
    addTask({ id: 'late', due: NOW - 21 * DAY })
    addTask({ id: 'later', due: NOW - 3 * DAY })
    addTask({ id: 'fine', due: NOW + 5 * DAY })
    addTask({ id: 'done', status: 'done', due: NOW - 90 * DAY, completed: NOW })

    const s = computeStats(getDatabase(), NOW)

    // A finished task is never overdue, however late it was.
    expect(s.tasksOverdue.count).toBe(2)
    expect(s.tasksOverdue.oldestDays).toBe(21)
  })

  it('uses the median completion latency, not the mean', () => {
    // Means are worthless here: one task abandoned for a year drags the
    // average past every real datapoint and the digest reports a fiction.
    addTask({ id: 'a', status: 'done', created: NOW - 10 * DAY, completed: NOW - 9 * DAY })
    addTask({ id: 'b', status: 'done', created: NOW - 10 * DAY, completed: NOW - 8 * DAY })
    addTask({ id: 'c', status: 'done', created: NOW - 400 * DAY, completed: NOW })

    expect(computeStats(getDatabase(), NOW).tasksLatencyDays).toBe(2)
  })

  it('reports null latency when nothing has been completed', () => {
    addTask({ id: 'open' })
    expect(computeStats(getDatabase(), NOW).tasksLatencyDays).toBeNull()
  })
})

describe('computeStats — jobs and projects', () => {
  it('computes the job failure rate over the window', () => {
    const db = getDatabase()
    db.prepare(`
      INSERT INTO jobs (id, name, capability_id, schedule_kind, schedule_expr, created_at)
      VALUES ('j1', 'Nightly', 'test.sync', 'interval', '1h', ?)
    `).run(NOW - 40 * DAY)

    const run = db.prepare('INSERT INTO job_runs (id, job_id, started_at, status) VALUES (?, ?, ?, ?)')
    run.run('r1', 'j1', NOW - 2 * DAY, 'success')
    run.run('r2', 'j1', NOW - 2 * DAY, 'failure')
    run.run('r3', 'j1', NOW - 2 * DAY, 'timeout')
    run.run('r4', 'j1', NOW - 60 * DAY, 'failure') // outside the window

    const s = computeStats(db, NOW)

    expect(s.jobsReliability.runs).toBe(3)
    expect(s.jobsReliability.failures).toBe(2) // timeout counts as a failure
    expect(s.jobsReliability.failureRate).toBeCloseTo(0.667, 2)
  })

  it('lists cold projects oldest first', () => {
    const db = getDatabase()
    const p = db.prepare(`
      INSERT INTO projects (id, path, name, status, last_modified, first_seen, last_scanned)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    p.run('p1', '/a', 'alpha', 'dormant', NOW - 70 * DAY, NOW, NOW)
    p.run('p2', '/b', 'beta', 'abandoned', NOW - 200 * DAY, NOW, NOW)
    p.run('p3', '/c', 'gamma', 'active', NOW - 2 * DAY, NOW, NOW)

    const s = computeStats(db, NOW)

    expect(s.coldProjects.map((c) => c.name)).toEqual(['beta', 'alpha'])
    expect(s.coldProjects[0].days).toBe(200)
  })
})

describe('refreshStats', () => {
  it('persists each metric', () => {
    addTask({ id: 'late', due: NOW - 10 * DAY })
    refreshStats(NOW)

    expect(store.getStat('tasks.overdue')).toEqual({ count: 1, oldestDays: 10 })
  })

  it('seeds a tendency fact once the overdue pile passes the threshold', () => {
    for (let i = 0; i < 6; i++) addTask({ id: `t${i}`, due: NOW - (i + 1) * DAY })
    refreshStats(NOW)

    const fact = store.listFacts().find((f) => f.key === 'overdue-backlog')
    expect(fact).toBeDefined()
    expect(fact!.source).toBe('stat')
    expect(fact!.body).toContain('6')
  })

  it('does not seed the fact below the threshold', () => {
    addTask({ id: 't0', due: NOW - DAY })
    refreshStats(NOW)
    expect(store.listFacts().find((f) => f.key === 'overdue-backlog')).toBeUndefined()
  })
})
