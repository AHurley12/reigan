import { getJobByName, setJobEnabled, upsertJob } from './store'
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

  ensure({
    name: 'Sync YouTube channel',
    capabilityId: 'youtube.sync',
    scheduleKind: 'daily_at',
    scheduleExpr: '05:00',
    // Analytics are cumulative, so replaying missed days would fetch the same
    // figures repeatedly and spend Data API quota to learn nothing new. One
    // catch-up sync brings the cache fully current.
    catchUpPolicy: 'run_once',
    timeoutMs: 30 * 60_000,
    // Left disabled until the user has connected a Google account with the
    // YouTube scopes — an enabled job would otherwise fail nightly, exhaust its
    // retry budget, and disable itself with a confusing error.
    enabled: false,
    disabledReason: 'Connect a Google account with YouTube access, then enable this job.',
  })

  ensure({
    name: 'Ingest YouTube reach reports',
    capabilityId: 'youtube.ingestReach',
    scheduleKind: 'daily_at',
    // Half an hour after the channel sync, so the videos a report references
    // are already in the catalog — reach rows for an unknown video are dropped.
    scheduleExpr: '05:30',
    // Reports Google has already generated stay listed for 60 days, so a missed
    // night is picked up whole by the next run. Replaying each missed day would
    // re-download the same files to write the same rows.
    catchUpPolicy: 'run_once',
    timeoutMs: 15 * 60_000,
    enabled: false,
    disabledReason: 'Connect a Google account with YouTube access, then enable this job.',
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
  enabled?: boolean
  disabledReason?: string
}): void {
  if (getJobByName(params.name)) return

  const { runImmediately, disabledReason, ...job } = params
  const enabled = params.enabled ?? true

  const created = upsertJob({
    ...job,
    system: true,
    enabled,
    nextRunAt: !enabled
      ? null
      : runImmediately
        ? Date.now()
        : nextOccurrence(params.scheduleKind, params.scheduleExpr, Date.now()),
  })

  // upsertJob has no disabled_reason parameter — it is written by the scheduler
  // when a job disables itself. A seeded job that ships disabled needs to say
  // why, or the Jobs view shows a dead row with no explanation.
  if (!enabled && disabledReason) setJobEnabled(created.id, false, disabledReason)
}
