import { getJobByName, upsertJob } from './store'
import { nextOccurrence } from './schedule'

/**
 * Built-in jobs, created once on first run.
 *
 * Seeded by name rather than by id so an existing job is recognised and left
 * alone — the user's own edits to schedule or catch-up policy survive upgrades.
 * They are marked `system`, which makes them disable-able but not deletable.
 */
export function seedSystemJobs(): void {
  ensure({
    name: 'Rebuild file index',
    capabilityId: 'files.reindex',
    scheduleKind: 'daily_at',
    scheduleExpr: '04:00',
    // A missed index rebuild only needs to happen once, however many nights the
    // machine was off — replaying four identical rebuilds would be pure waste.
    catchUpPolicy: 'run_once',
    timeoutMs: 20 * 60_000,
    // Runs once immediately on the very first boot, then settles onto 04:00.
    // Waiting until 4am for the first index would leave the Files panel empty
    // all day on a fresh install — a regression against the boot-time index
    // this job replaces.
    runImmediately: true,
  })
}

function ensure(params: {
  name: string
  capabilityId: string
  scheduleKind: 'interval' | 'cron' | 'daily_at' | 'weekly_on' | 'manual'
  scheduleExpr: string
  catchUpPolicy: 'run_once' | 'run_all' | 'skip'
  timeoutMs?: number
  runImmediately?: boolean
}): void {
  if (getJobByName(params.name)) return

  const { runImmediately, ...job } = params
  upsertJob({
    ...job,
    system: true,
    enabled: true,
    nextRunAt: runImmediately
      ? Date.now()
      : nextOccurrence(params.scheduleKind, params.scheduleExpr, Date.now()),
  })
}
