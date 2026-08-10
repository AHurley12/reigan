import { z } from 'zod'
import { randomUUID } from 'crypto'
import { getDatabase } from '../../db/database'
import { buildPlan, describePlan, type Plan } from '../../devtools/organizer/plan'
import { executePlan, listRuns, undoRun, type ExecuteResult, type RunRow, type UndoResult } from '../../devtools/organizer/execute'
import { describeDuplicates, findDuplicates, type DuplicateReport } from '../../devtools/organizer/duplicates'
import { builtinPresets, type Action, type CollisionPolicy, type Condition } from '../../devtools/organizer/rules'
import { CapabilityError, type AnyCapability } from '../types'

/**
 * File & folder organiser.
 *
 * The asymmetry between planning and executing is deliberate and is the whole
 * safety design: `files.planOrganize` is read-only and never prompts, so
 * "what would you clean up in Downloads?" gets a complete, specific answer
 * with nothing moved. `files.executePlan` consumes a plan the user has already
 * seen and is destructive-tier, so it always prompts.
 */

/**
 * Plans awaiting execution.
 *
 * In memory rather than in SQLite, with a short life. A plan is a snapshot of
 * a directory at one moment; one recovered after a restart would describe a
 * filesystem that has since moved on, and executing it would be acting on
 * stale information the user reviewed hours ago.
 */
const PLAN_TTL_MS = 30 * 60 * 1000
const planCache = new Map<string, { plan: Plan; createdAt: number }>()

function cachePlan(plan: Plan): string {
  const id = randomUUID()
  planCache.set(id, { plan, createdAt: Date.now() })
  for (const [key, entry] of planCache) {
    if (Date.now() - entry.createdAt > PLAN_TTL_MS) planCache.delete(key)
  }
  return id
}

function takePlan(id: string): Plan {
  const entry = planCache.get(id)
  if (!entry) {
    throw new CapabilityError(
      `Plan ${id} is unknown or has expired. Build a fresh one with files.planOrganize — a plan older than 30 minutes may no longer match what is on disk.`,
      'not_found'
    )
  }
  if (Date.now() - entry.createdAt > PLAN_TTL_MS) {
    planCache.delete(id)
    throw new CapabilityError(`Plan ${id} has expired. Build a fresh one.`, 'not_found')
  }
  return entry.plan
}

const conditionSchema: z.ZodType<Condition> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('extension'), values: z.array(z.string()) }),
  z.object({ kind: z.literal('nameMatches'), pattern: z.string() }),
  z.object({ kind: z.literal('sizeGreaterThan'), bytes: z.number() }),
  z.object({ kind: z.literal('sizeLessThan'), bytes: z.number() }),
  z.object({ kind: z.literal('olderThan'), days: z.number(), field: z.enum(['created', 'modified']) }),
  z.object({ kind: z.literal('newerThan'), days: z.number(), field: z.enum(['created', 'modified']) }),
  z.object({
    kind: z.literal('mimeFamily'),
    values: z.array(z.enum(['image', 'video', 'audio', 'document', 'archive', 'code', 'installer', 'other'])),
  }),
  z.object({ kind: z.literal('isDuplicate') }),
]) as z.ZodType<Condition>

const actionSchema: z.ZodType<Action> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('moveTo'), destination: z.string() }),
  z.object({ kind: z.literal('renameTo'), pattern: z.string() }),
  z.object({ kind: z.literal('copyTo'), destination: z.string() }),
  z.object({ kind: z.literal('trash') }),
  z.object({ kind: z.literal('tag'), tag: z.string() }),
  z.object({ kind: z.literal('flagForReview') }),
]) as z.ZodType<Action>

export const fileorgCapabilities: AnyCapability[] = [
  {
    id: 'files.planOrganize',
    title: 'Plan a file cleanup',
    description:
      "Work out what a set of organising rules would do to a folder, without touching anything. Returns the exact list of moves, renames and trashings, with counts and total size. Always safe to call — nothing is moved until files.executePlan runs with the returned planId. Use this to answer 'what would you clean up in X?'. Destinations support {yyyy} {MM} {dd} {name} {ext} {family} tokens, so 'Archive/{yyyy}/{MM}' sorts by date. The folder must be an allowlisted managed root.",
    risk: 'read',
    schema: z.object({
      scopePath: z.string().describe('Absolute path of the folder to organise.'),
      recursive: z.boolean().optional().default(false),
      conditions: z.array(conditionSchema).min(1).describe('All conditions must match for a file to be included.'),
      actions: z.array(actionSchema).min(1),
      collisionPolicy: z.enum(['skip', 'rename', 'overwrite']).optional().default('rename'),
    }),
    handler: async (args: {
      scopePath: string
      recursive?: boolean
      conditions: Condition[]
      actions: Action[]
      collisionPolicy?: CollisionPolicy
    }) => {
      const plan = await buildPlan({
        scopePath: args.scopePath,
        recursive: args.recursive ?? false,
        conditions: args.conditions,
        actions: args.actions,
        collisionPolicy: args.collisionPolicy ?? 'rename',
      })
      return { planId: cachePlan(plan), plan }
    },
    formatResult: (r: { planId: string; plan: Plan }) => {
      const preview = r.plan.ops
        .slice(0, 25)
        .map((op) =>
          op.destPath
            ? `  ${op.type}: ${op.sourcePath}\n      → ${op.destPath}${op.note ? ` (${op.note})` : ''}`
            : `  ${op.type}: ${op.sourcePath}${op.note ? ` (${op.note})` : ''}`
        )
        .join('\n')
      const more = r.plan.ops.length > 25 ? `\n  …and ${r.plan.ops.length - 25} more.` : ''
      const skipped = r.plan.skipped.length
        ? `\n\nSkipped:\n${r.plan.skipped.slice(0, 10).map((s) => `  ${s.path} — ${s.reason}`).join('\n')}`
        : ''
      return `${describePlan(r.plan)}\n\nplanId: ${r.planId}\n${preview}${more}${skipped}`
    },
  },

  {
    id: 'files.executePlan',
    title: 'Execute a file cleanup plan',
    description:
      'Carry out a plan produced by files.planOrganize. Requires the planId from that call. Every operation is re-checked against the path guardrails at execution time, deletions go to the Recycle Bin rather than being erased, and the whole run is reversible with files.undoRun.',
    risk: 'destructive',
    schema: z.object({
      planId: z.string().describe('The planId returned by files.planOrganize.'),
      ruleId: z.string().optional(),
    }),
    approval: {
      summary: (args: { planId: string }) => {
        const entry = planCache.get(args.planId)
        return entry
          ? `Carry out ${entry.plan.ops.length} file operation(s) in ${entry.plan.scopePath}.`
          : `Carry out file plan ${args.planId} (no longer in memory).`
      },
      // The blast radius, spelled out. Approving "execute plan abc-123" without
      // this would be approving an opaque identifier.
      diff: (args: { planId: string }) => {
        const entry = planCache.get(args.planId)
        if (!entry) return null
        const { plan } = entry
        const counts = new Map<string, number>()
        for (const op of plan.ops) counts.set(op.type, (counts.get(op.type) ?? 0) + 1)

        return {
          subject: plan.scopePath,
          changes: [
            { field: 'Operations', before: [...counts].map(([t, n]) => `${n} ${t}`).join(', '), after: null },
            { field: 'Data affected', before: `${(plan.totalBytes / 1048576).toFixed(1)} MB`, after: null },
            { field: 'Destination folders', before: plan.destinations.slice(0, 8).join(', ') || '(none)', after: null },
            {
              field: 'First few',
              before: plan.ops.slice(0, 5).map((o) => `${o.type} ${o.sourcePath}`).join(' · '),
              after: null,
            },
            { field: 'Reversible', before: 'yes — deletions go to the Recycle Bin', after: null },
          ],
        }
      },
    },
    handler: async (args: { planId: string; ruleId?: string }, ctx) => {
      const plan = takePlan(args.planId)
      const result = await executePlan(plan, {
        ruleId: args.ruleId,
        signal: ctx.signal,
        onProgress: (done, total) => ctx.onProgress?.({ done, total, label: 'Applying plan' }),
      })
      planCache.delete(args.planId)
      return result
    },
    formatResult: (r: ExecuteResult) =>
      `Executed ${r.executed} operation(s), ${(r.bytesMoved / 1048576).toFixed(1)} MB moved.` +
      (r.failed.length
        ? `\n${r.failed.length} failed:\n${r.failed.slice(0, 10).map((f) => `  ${f.path} — ${f.error}`).join('\n')}`
        : '') +
      `\nUndo with files.undoRun runId=${r.runId}.`,
  },

  {
    id: 'files.undoRun',
    title: 'Undo a file cleanup run',
    description:
      'Reverse a previously executed organiser run, moving every file back where it was. Files sent to the Recycle Bin are reported rather than restored — Windows has no reliable scriptable restore, so those need one click in the bin.',
    risk: 'write',
    schema: z.object({ runId: z.string() }),
    approval: {
      summary: (args: { runId: string }) => `Move every file from run ${args.runId} back to its original location.`,
    },
    handler: async (args: { runId: string }) => undoRun(args.runId),
    formatResult: (r: UndoResult) => {
      const parts = [`Reversed ${r.reversed} operation(s) from run ${r.runId}.`]
      if (r.checksumMismatches.length) {
        parts.push(
          `${r.checksumMismatches.length} file(s) had changed since the move and were restored anyway: ` +
            r.checksumMismatches.slice(0, 5).join(', ')
        )
      }
      if (r.failed.length) {
        parts.push(`Could not reverse ${r.failed.length}:\n${r.failed.slice(0, 10).map((f) => `  ${f.path} — ${f.reason}`).join('\n')}`)
      }
      return parts.join('\n')
    },
  },

  {
    id: 'files.findDuplicates',
    title: 'Find duplicate files',
    description:
      'Find byte-identical files in a folder. Compares by size first, then a cheap head+tail digest, then a full SHA-256 only on what survives — so it is fast even on a large folder. Report only: nothing is deleted, and each group comes with a suggested keeper.',
    risk: 'read',
    schema: z.object({
      scopePath: z.string(),
      recursive: z.boolean().optional().default(true),
      minSizeBytes: z.number().int().min(0).optional().describe('Ignore files below this size. Default 1024.'),
    }),
    handler: async (args: { scopePath: string; recursive?: boolean; minSizeBytes?: number }, ctx) =>
      findDuplicates({
        scopePath: args.scopePath,
        recursive: args.recursive,
        minSizeBytes: args.minSizeBytes,
        signal: ctx.signal,
        onProgress: (done, total, label) => ctx.onProgress?.({ done, total, label }),
      }),
    formatResult: (r: DuplicateReport) => describeDuplicates(r),
  },

  {
    id: 'files.listRules',
    title: 'List organiser rules',
    description: 'List saved file-organising rules and the shipped presets.',
    risk: 'read',
    schema: z.object({}),
    handler: async () => {
      const rows = getDatabase().prepare('SELECT * FROM organizer_rules ORDER BY name').all() as any[]
      return {
        rules: rows.map((r) => ({
          id: r.id,
          name: r.name,
          enabled: !!r.enabled,
          scopePath: r.scope_path,
          recursive: !!r.recursive,
          conditions: JSON.parse(r.conditions_json),
          actions: JSON.parse(r.actions_json),
          lastRunAt: r.last_run_at,
          filesAffectedTotal: r.files_affected_total,
        })),
        presets: builtinPresets().map((p) => p.name),
      }
    },
    formatResult: (r: { rules: Array<{ name: string; enabled: boolean; scopePath: string }>; presets: string[] }) =>
      (r.rules.length
        ? `Saved rules:\n${r.rules.map((x) => `  • ${x.name} (${x.enabled ? 'enabled' : 'disabled'}) — ${x.scopePath}`).join('\n')}`
        : 'No saved rules.') + `\nAvailable presets: ${r.presets.join(', ')}.`,
  },

  {
    id: 'files.upsertRule',
    title: 'Save an organiser rule',
    description: 'Create or update a saved file-organising rule. Saving a rule does not run it.',
    risk: 'write',
    schema: z.object({
      id: z.string().optional(),
      name: z.string().min(1),
      enabled: z.boolean().optional().default(false),
      scopePath: z.string(),
      recursive: z.boolean().optional().default(false),
      conditions: z.array(conditionSchema).min(1),
      actions: z.array(actionSchema).min(1),
      collisionPolicy: z.enum(['skip', 'rename', 'overwrite']).optional().default('rename'),
    }),
    approval: {
      summary: (args: { name: string; scopePath: string }) =>
        `Save the organiser rule "${args.name}" for ${args.scopePath}. Saving does not run it.`,
    },
    handler: async (args: any) => {
      const id = args.id ?? randomUUID()
      getDatabase()
        .prepare(
          `INSERT INTO organizer_rules
             (id, name, enabled, scope_path, recursive, conditions_json, actions_json, schedule, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)
           ON CONFLICT(id) DO UPDATE SET
             name = excluded.name, enabled = excluded.enabled, scope_path = excluded.scope_path,
             recursive = excluded.recursive, conditions_json = excluded.conditions_json,
             actions_json = excluded.actions_json`
        )
        .run(
          id,
          args.name,
          args.enabled ? 1 : 0,
          args.scopePath,
          args.recursive ? 1 : 0,
          JSON.stringify(args.conditions),
          JSON.stringify(args.actions),
          Date.now()
        )
      return { id, name: args.name }
    },
    formatResult: (r: { name: string }) => `Saved rule "${r.name}".`,
  },

  {
    id: 'files.listRuns',
    title: 'Organiser run history',
    description: 'List past organiser runs, with how many operations each performed and whether it can still be undone.',
    risk: 'read',
    schema: z.object({ limit: z.number().int().min(1).max(200).optional() }),
    handler: async (args: { limit?: number }) => ({ runs: listRuns(args.limit ?? 25) }),
    formatResult: (r: { runs: RunRow[] }) =>
      r.runs.length === 0
        ? 'No organiser runs yet.'
        : r.runs
            .map(
              (x) =>
                `${new Date(x.startedAt).toISOString().slice(0, 16).replace('T', ' ')} ` +
                `${x.mode} — ${x.opsExecuted}/${x.opsPlanned} ops, ${x.status}` +
                `${x.reversible ? ` (undo: ${x.id})` : ''}`
            )
            .join('\n'),
  },
]
