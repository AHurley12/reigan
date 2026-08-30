import { z } from 'zod'
import { randomUUID } from 'crypto'
import { getDatabase } from '../../db/database'
import { classifyCommand } from '../../devtools/shell/classify'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  listHistory,
  loadUserRules,
  recordHistory,
  resolveShell,
  runCommand,
  type HistoryRow,
  type RunResult,
} from '../../devtools/shell/run'
import { resolveProject } from '../../devtools/scanner/store'
import { CapabilityError, type AnyCapability } from '../types'

/**
 * Shell capabilities.
 *
 * Interactive PTY sessions are absent: node-pty needs an MSVC toolchain that
 * is not installed on this machine, so `shell.sessionCreate` / `sessionWrite`
 * / `sessionKill` / `listSessions` are not registered rather than being
 * registered as stubs that fail when called. A tool the model can see and
 * cannot use is worse than one that isn't there.
 */

const runSchema = z.object({
  command: z.string().min(1).describe('The command line to run.'),
  cwd: z
    .string()
    .optional()
    .describe('Working directory. May be an absolute path or an indexed project name.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TIMEOUT_MS)
    .optional()
    .describe(`Kill the command after this long. Default ${DEFAULT_TIMEOUT_MS}ms.`),
})

type RunArgs = z.infer<typeof runSchema>

function resolveCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  // A bare project name is far likelier than an absolute path when the model
  // is asked to "run the tests in Argus".
  const project = resolveProject(cwd)
  return project?.path ?? cwd
}

export const shellCapabilities: AnyCapability[] = [
  {
    id: 'shell.run',
    title: 'Run a shell command',
    description:
      "Run a single command in PowerShell and return its exit code, stdout and stderr. Read-only commands (git status, npm ls, dir, Get-Process, --version checks) run immediately. Anything else needs the user's approval first. Genuinely destructive commands — formatting a drive, recursive deletes at a drive root, shutdown, registry writes to HKLM, piping a download into a shell — are refused outright and cannot be approved. Output is capped at 100KB and the command is killed after the timeout. Set cwd to a project name to run inside that project.",
    // The honest worst case, and what the capability list shows. dynamicRisk
    // narrows it per command so that `git status` does not prompt.
    risk: 'destructive',
    schema: runSchema,
    dynamicRisk: (args: RunArgs) => {
      const verdict = classifyCommand(args.command, loadUserRules())
      if (verdict.tier === 'allow') return 'read'
      // A blocked command is refused by the handler; treating it as
      // destructive here means that if the refusal is ever removed, the
      // failure mode is an approval prompt rather than silent execution.
      return 'destructive'
    },
    approval: {
      summary: (args: RunArgs) => {
        const verdict = classifyCommand(args.command, loadUserRules())
        return `Run: ${args.command}${args.cwd ? ` (in ${args.cwd})` : ''} — ${verdict.reason}`
      },
      diff: (args: RunArgs) => {
        const verdict = classifyCommand(args.command, loadUserRules())
        return {
          subject: args.command,
          changes: [
            { field: 'Shell', before: resolveShell().file, after: null },
            { field: 'Working directory', before: resolveCwd(args.cwd) ?? '(home)', after: null },
            { field: 'Classification', before: verdict.tier, after: null },
            { field: 'Why', before: verdict.reason, after: null },
            ...(verdict.segments.length > 1
              ? [{ field: 'Segments', before: verdict.segments.join('  ⟶  '), after: null }]
              : []),
          ],
        }
      },
    },
    handler: async (args: RunArgs, ctx) => {
      const verdict = classifyCommand(args.command, loadUserRules())

      if (verdict.tier === 'block') {
        // Recorded even though it never ran — a refused command is exactly the
        // kind of thing worth being able to look back at.
        recordHistory({
          command: args.command,
          cwd: resolveCwd(args.cwd) ?? '',
          classification: 'block',
          approvedBy: null,
          exitCode: null,
          durationMs: 0,
          output: `Refused: ${verdict.reason}`,
        })
        throw new CapabilityError(
          `Refused to run this command. ${verdict.reason}` +
            (verdict.offendingSegment && verdict.segments.length > 1
              ? ` The whole command line is refused, not just that part.`
              : ''),
          'denied'
        )
      }

      const result = await runCommand({
        command: args.command,
        cwd: resolveCwd(args.cwd),
        timeoutMs: args.timeoutMs,
        signal: ctx.signal,
      })

      recordHistory({
        command: args.command,
        cwd: result.cwd,
        classification: verdict.tier,
        approvedBy: verdict.tier === 'allow' ? 'allowlist' : ctx.invokedBy,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        output: `${result.stdout}\n${result.stderr}`.trim(),
      })

      return result
    },
    formatResult: (r: RunResult) => {
      const head = r.timedOut
        ? `Timed out after ${(r.durationMs / 1000).toFixed(1)}s and was killed.`
        : `Exit code ${r.exitCode} in ${(r.durationMs / 1000).toFixed(1)}s.`

      const body = [
        r.stdout.trim() ? `stdout:\n${r.stdout.trim()}` : '',
        r.stderr.trim() ? `stderr:\n${r.stderr.trim()}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')

      const note = r.truncated ? '\n\n[Output truncated at 100KB.]' : ''
      return `${head}${body ? `\n\n${body}` : ' No output.'}${note}`
    },
  },

  {
    id: 'shell.classify',
    title: 'Check how a command would be classified',
    description:
      'Report whether a command would run immediately, need approval, or be refused — without running it. Useful for explaining to the user why something will prompt, or checking a command before proposing it.',
    risk: 'read',
    schema: z.object({ command: z.string().min(1) }),
    handler: async (args: { command: string }) => classifyCommand(args.command, loadUserRules()),
    formatResult: (c: ReturnType<typeof classifyCommand>) =>
      `${c.tier.toUpperCase()} — ${c.reason}${
        c.segments.length > 1 ? `\nSegments: ${c.segments.join(' ⟶ ')}` : ''
      }`,
  },

  {
    id: 'shell.history',
    title: 'Recent commands',
    description:
      'List recently run commands with their classification, exit code and duration. Read-only.',
    risk: 'read',
    schema: z.object({ limit: z.number().int().min(1).max(500).optional() }),
    handler: async (args: { limit?: number }) => ({ history: listHistory(args.limit ?? 50) }),
    formatResult: (r: { history: HistoryRow[] }) =>
      r.history.length === 0
        ? 'No commands have been run yet.'
        : r.history
            .map(
              (h) =>
                `${new Date(h.ranAt).toISOString().slice(0, 16).replace('T', ' ')} [${h.classification}] ` +
                `exit=${h.exitCode ?? '—'} ${h.command}`
            )
            .join('\n'),
  },

  {
    id: 'shell.addRule',
    title: 'Add a command rule',
    description:
      "Add a personal rule that always allows or always blocks commands matching a pattern. User rules override the built-in lists: a block always wins, and an allow can promote a command that would otherwise need approval. Use when the user says something like 'stop asking me about npm run build'.",
    risk: 'write',
    approval: {
      summary: (args: { pattern: string; tier: string; isRegex?: boolean }) =>
        `Always ${args.tier} commands matching ${args.isRegex ? 'regex' : 'text'} "${args.pattern}".`,
    },
    schema: z.object({
      pattern: z.string().min(1),
      tier: z.enum(['allow', 'block']),
      isRegex: z.boolean().optional(),
      note: z.string().optional(),
    }),
    handler: async (args: { pattern: string; tier: 'allow' | 'block'; isRegex?: boolean; note?: string }) => {
      getDatabase()
        .prepare(
          'INSERT INTO shell_rules (id, pattern, tier, is_regex, note, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(randomUUID(), args.pattern, args.tier, args.isRegex ? 1 : 0, args.note ?? null, Date.now())
      return { pattern: args.pattern, tier: args.tier }
    },
    formatResult: (r: { pattern: string; tier: string }) =>
      `Commands matching "${r.pattern}" will now always ${r.tier}.`,
  },
]
