import { z } from 'zod'
import { getCapability } from '../registry'
import { CapabilityError, type AnyCapability } from '../types'
import {
  deleteJob,
  getJob,
  listJobs,
  listRuns,
  setJobEnabled,
  setNextRun,
  upsertJob,
} from '../../jobs/store'
import { isJobRunning, runJobNow } from '../../jobs/scheduler'
import { formatRelative, nextOccurrence, validateSchedule } from '../../jobs/schedule'

/**
 * The scheduler's own control surface. `jobs.*` is how both the Jobs view and
 * REIGAN inspect and steer every automation in the app.
 */

const scheduleKindEnum = z.enum(['interval', 'cron', 'daily_at', 'weekly_on', 'manual'])
const catchUpEnum = z.enum(['run_once', 'run_all', 'skip'])

const upsertSchema = z.object({
  id: z.string().optional().describe('Omit to create a new job; supply to update an existing one'),
  name: z.string().min(1).describe('Human-readable job name'),
  capabilityId: z.string().describe('The capability this job invokes, e.g. "youtube.sync"'),
  args: z.record(z.unknown()).optional().describe('Arguments passed to the capability'),
  scheduleKind: scheduleKindEnum,
  scheduleExpr: z
    .string()
    .optional()
    .describe(
      'interval: minutes ("15"). daily_at: "09:30". weekly_on: "MON,THU@14:00". cron: "0 3 * * *". manual: omit.'
    ),
  enabled: z.boolean().optional(),
  catchUpPolicy: catchUpEnum.optional().describe(
    'What to do about runs missed while the app was closed: run_once, run_all, or skip'
  ),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
})

const idSchema = z.object({ id: z.string().describe('The job id') })

export const jobCapabilities: AnyCapability[] = [
  {
    id: 'jobs.list',
    title: 'List scheduled jobs',
    description:
      'List every scheduled automation with its schedule, next run time, and the status of its last run. Use to answer questions about what is scheduled or why an automation has not run.',
    risk: 'read',
    schema: z.object({}),
    handler: () =>
      listJobs().map((job) => ({
        ...job,
        running: isJobRunning(job.id),
        nextRunRelative: job.nextRunAt === null ? null : formatRelative(job.nextRunAt),
      })),
    formatResult: (jobs: Array<any>) => {
      if (jobs.length === 0) return 'No scheduled jobs.'
      return jobs
        .map((j) => {
          const state = !j.enabled
            ? `disabled${j.disabledReason ? ` (${j.disabledReason})` : ''}`
            : j.running
              ? 'running now'
              : j.nextRunRelative
                ? `next ${j.nextRunRelative}`
                : 'manual'
          const last = j.lastStatus ? `, last ${j.lastStatus}` : ''
          return `• ${j.name} — ${j.scheduleDescription}; ${state}${last}`
        })
        .join('\n')
    },
  },

  {
    id: 'jobs.history',
    title: 'Job run history',
    description:
      'Recent run history for a job, including errors. Use when asked why an automation failed or when it last ran.',
    risk: 'read',
    schema: z.object({
      id: z.string().describe('The job id'),
      limit: z.number().int().min(1).max(100).optional(),
    }),
    handler: ({ id, limit }: { id: string; limit?: number }) => {
      if (!getJob(id)) throw new CapabilityError(`No job with id ${id}.`, 'not_found')
      return listRuns(id, limit ?? 20)
    },
    formatResult: (runs: Array<any>) => {
      if (runs.length === 0) return 'No runs recorded yet.'
      return runs
        .map((r) => {
          const when = new Date(r.startedAt).toLocaleString()
          const duration = r.finishedAt ? ` (${((r.finishedAt - r.startedAt) / 1000).toFixed(1)}s)` : ''
          const error = r.error ? ` — ${r.error}` : ''
          return `• ${when}: ${r.status}${duration} [${r.triggeredBy}]${error}`
        })
        .join('\n')
    },
  },

  {
    id: 'jobs.upsert',
    title: 'Create or update a job',
    description:
      'Create a new scheduled automation, or update an existing one. Schedules an existing capability to run on a recurring basis.',
    risk: 'write',
    schema: upsertSchema,
    approval: {
      summary: (args: z.infer<typeof upsertSchema>) =>
        args.id
          ? `Update scheduled job "${args.name}"`
          : `Schedule "${args.name}" to run ${args.scheduleKind === 'manual' ? 'manually' : `(${args.scheduleKind} ${args.scheduleExpr ?? ''})`}`,
      diff: (args: z.infer<typeof upsertSchema>) => {
        const existing = args.id ? getJob(args.id) : null
        return {
          subject: args.name,
          changes: [
            {
              field: 'capability',
              before: existing?.capabilityId ?? null,
              after: args.capabilityId,
            },
            {
              field: 'schedule',
              before: existing ? existing.scheduleDescription : null,
              after: `${args.scheduleKind} ${args.scheduleExpr ?? ''}`.trim(),
            },
            {
              field: 'enabled',
              before: existing ? String(existing.enabled) : null,
              after: String(args.enabled ?? true),
            },
          ],
        }
      },
    },
    handler: (args: z.infer<typeof upsertSchema>) => {
      const target = getCapability(args.capabilityId)
      if (!target) {
        throw new CapabilityError(
          `Cannot schedule "${args.capabilityId}" — no such capability.`,
          'not_found'
        )
      }
      // A job pointing at a UI-only capability would run it under `invokedBy:
      // 'job'`, which dispatch refuses — better to reject it at save time than
      // to create a job that can only ever fail.
      if (target.uiOnly) {
        throw new CapabilityError(
          `"${args.capabilityId}" cannot be scheduled (${target.uiOnlyReason ?? 'UI only'}).`,
          'denied'
        )
      }

      const expr = args.scheduleExpr ?? ''
      validateSchedule(args.scheduleKind, expr)

      const nextRunAt =
        (args.enabled ?? true) && args.scheduleKind !== 'manual'
          ? nextOccurrence(args.scheduleKind, expr, Date.now())
          : null

      return upsertJob({ ...args, scheduleExpr: expr, nextRunAt })
    },
    formatResult: (job: any) =>
      `Job "${job.name}" saved — ${job.scheduleDescription}${
        job.nextRunAt ? `, next run ${formatRelative(job.nextRunAt)}` : ''
      }.`,
  },

  {
    id: 'jobs.enable',
    title: 'Enable a job',
    description: 'Re-enable a scheduled job, clearing any auto-disabled state and rescheduling it.',
    risk: 'write',
    schema: idSchema,
    approval: {
      summary: ({ id }: { id: string }) => {
        const job = getJob(id)
        return job ? `Enable scheduled job "${job.name}"` : `Enable job ${id}`
      },
    },
    handler: ({ id }: { id: string }) => {
      const job = getJob(id)
      if (!job) throw new CapabilityError(`No job with id ${id}.`, 'not_found')

      setJobEnabled(id, true, null)
      const next =
        job.scheduleKind === 'manual'
          ? null
          : nextOccurrence(job.scheduleKind, job.scheduleExpr, Date.now())
      setNextRun(id, next)
      return getJob(id)
    },
    formatResult: (job: any) =>
      `Enabled "${job.name}"${job.nextRunAt ? ` — next run ${formatRelative(job.nextRunAt)}` : ''}.`,
  },

  {
    id: 'jobs.disable',
    title: 'Disable a job',
    description: 'Disable a scheduled job so it stops running. Its history is kept.',
    risk: 'write',
    schema: idSchema,
    approval: {
      summary: ({ id }: { id: string }) => {
        const job = getJob(id)
        return job ? `Disable scheduled job "${job.name}"` : `Disable job ${id}`
      },
    },
    handler: ({ id }: { id: string }) => {
      const job = getJob(id)
      if (!job) throw new CapabilityError(`No job with id ${id}.`, 'not_found')
      setJobEnabled(id, false, 'Disabled manually.')
      setNextRun(id, null)
      return getJob(id)
    },
    formatResult: (job: any) => `Disabled "${job.name}".`,
  },

  {
    id: 'jobs.runNow',
    title: 'Run a job now',
    description:
      'Trigger a scheduled job immediately, outside its schedule. Does not affect its next scheduled run.',
    risk: 'write',
    schema: idSchema,
    approval: {
      summary: ({ id }: { id: string }) => {
        const job = getJob(id)
        return job ? `Run "${job.name}" now` : `Run job ${id} now`
      },
    },
    handler: async ({ id }: { id: string }) => {
      const outcome = await runJobNow(id)
      if (!outcome.ok) throw new CapabilityError(outcome.message, 'handler_failed')
      return outcome
    },
    formatResult: (outcome: { message: string }) => outcome.message,
  },

  {
    id: 'jobs.delete',
    title: 'Delete a job',
    description: 'Permanently delete a scheduled job and its run history.',
    risk: 'destructive',
    schema: idSchema,
    approval: {
      summary: ({ id }: { id: string }) => {
        const job = getJob(id)
        return job ? `Permanently delete scheduled job "${job.name}"` : `Delete job ${id}`
      },
    },
    handler: ({ id }: { id: string }) => {
      const job = getJob(id)
      if (!job) throw new CapabilityError(`No job with id ${id}.`, 'not_found')
      if (job.system) {
        throw new CapabilityError(
          `"${job.name}" is a built-in job and cannot be deleted. Disable it instead.`,
          'denied'
        )
      }
      deleteJob(id)
      return { id, name: job.name }
    },
    formatResult: (r: { name: string }) => `Deleted job "${r.name}".`,
  },
]
