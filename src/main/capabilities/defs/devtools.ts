import { z } from 'zod'
import { shell } from 'electron'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { configuredRoots, runScan } from '../../devtools/scanner'
import {
  listProjects,
  resolveProject,
  type ProjectSummary,
  type ProjectWithFlags,
} from '../../devtools/scanner/store'
import { CapabilityError, type AnyCapability } from '../types'

/**
 * Code Project Scanner capabilities.
 *
 * `listProjects` is the one the model reaches for most, so it returns a
 * summary aggregate alongside the rows: "you have 7 abandoned JavaScript
 * projects and 2 that look active" should be answerable from a single call,
 * without the model counting rows itself and getting it wrong.
 */

const STATUSES = ['active', 'warm', 'dormant', 'abandoned'] as const

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

function formatAge(timestamp: number | null): string {
  if (!timestamp) return 'never'
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

function describeProject(p: ProjectWithFlags): string {
  const bits: string[] = [p.status]
  if (p.primaryLanguage) bits.push(p.primaryLanguage)
  if (p.frameworks.length) bits.push(p.frameworks.slice(0, 3).join('/'))
  bits.push(`touched ${formatAge(p.lastModified)}`)

  const notes: string[] = []
  if (p.flags.uncommittedChanges) notes.push('uncommitted changes')
  if (p.flags.unpushedCommits) notes.push(`${p.unpushedCount} unpushed`)
  if (p.flags.neverCommitted) notes.push('never committed')
  if (p.flags.noReadme) notes.push('no readme')

  const tail = notes.length ? ` — ${notes.join(', ')}` : ''
  return `${p.name} (${bits.join(', ')})${tail}\n    ${p.path}`
}

function describeSummary(s: ProjectSummary): string {
  const statuses = STATUSES.filter((k) => s.byStatus[k] > 0)
    .map((k) => `${s.byStatus[k]} ${k}`)
    .join(', ')
  const langs = s.topLanguages
    .slice(0, 4)
    .map((l) => `${l.language} ${l.count}`)
    .join(', ')

  return [
    `${s.total} projects total${statuses ? ` — ${statuses}` : ''}.`,
    `${formatBytes(s.totalSizeBytes)} on disk (${formatBytes(s.totalSizeBytesNoDeps)} excluding dependencies).`,
    `${s.withUncommittedChanges} with uncommitted changes, ${s.withUnpushedCommits} with unpushed commits, ${s.missingReadme} without a proper README.`,
    langs ? `Most common: ${langs}.` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

export const devtoolsCapabilities: AnyCapability[] = [
  {
    id: 'devtools.scanProjects',
    title: 'Scan for code projects',
    description:
      "Walk the user's configured folders and index every code project found — language mix, frameworks, git state, size, and how recently each was touched. Read-only: it reads the filesystem and writes only to REIGAN's own index. Slow on a first run (expect tens of seconds); subsequent runs skip folders that have not changed. Call this when the index is empty or the user asks for fresh results, then use devtools.listProjects to read them.",
    risk: 'read',
    schema: z.object({
      full: z
        .boolean()
        .optional()
        .describe('Ignore the incremental skip and re-walk every root. Slower; use when results look stale.'),
      roots: z
        .array(z.string())
        .optional()
        .describe('Override the configured root folders for this scan only.'),
    }),
    handler: async (args: { full?: boolean; roots?: string[] }, ctx) => {
      const result = await runScan({
        full: args.full,
        roots: args.roots,
        signal: ctx.signal,
        onProgress: (p) =>
          ctx.onProgress?.({
            done: p.dirsWalked,
            // Genuinely unknown until the walk finishes, and inventing a total
            // would produce a progress bar that lies. The UI renders an
            // indeterminate count when total is 0.
            total: 0,
            label: p.current ? `Scanning ${p.current}` : 'Scanning…',
          }),
      })
      return result
    },
    formatResult: (r: {
      projectsFound: number
      dirsWalked: number
      durationMs: number
      skippedRoots: string[]
      removed: number
    }) => {
      const parts = [
        `Scanned ${r.dirsWalked} directories in ${(r.durationMs / 1000).toFixed(1)}s and indexed ${r.projectsFound} projects.`,
      ]
      if (r.skippedRoots.length) parts.push(`${r.skippedRoots.length} unchanged root(s) skipped.`)
      if (r.removed) parts.push(`${r.removed} project(s) no longer on disk were removed from the index.`)
      return parts.join(' ')
    },
  },

  {
    id: 'devtools.listProjects',
    title: 'List indexed projects',
    description:
      "List the user's code projects from the index, with optional filters. Returns a summary (counts by activity status, total disk usage, how many have uncommitted or unpushed work) alongside the matching rows, so questions like 'how many abandoned JS projects do I have?' or 'which projects have uncommitted changes?' can be answered from one call. Reads the stored index — call devtools.scanProjects first if it is empty or stale. Activity status: active = touched in the last 14 days, warm = 15-60, dormant = 61-180, abandoned = 180+.",
    risk: 'read',
    schema: z.object({
      status: z.enum(STATUSES).optional().describe('Filter by activity status.'),
      language: z.string().optional().describe('Filter by language, e.g. "TypeScript", "Python".'),
      framework: z.string().optional().describe('Filter by framework, e.g. "React", "Django".'),
      flag: z
        .enum(['never-committed', 'no-readme', 'uncommitted-changes', 'unpushed-commits'])
        .optional()
        .describe('Filter to projects carrying a particular problem flag.'),
      search: z.string().optional().describe('Match against project name or path.'),
      limit: z.number().int().min(1).max(500).optional(),
    }),
    handler: async (args: Parameters<typeof listProjects>[0]) => listProjects(args),
    formatResult: (r: { projects: ProjectWithFlags[]; summary: ProjectSummary }) => {
      if (r.summary.total === 0) {
        return 'The project index is empty. Run devtools.scanProjects first.'
      }
      if (r.projects.length === 0) {
        return `No projects matched that filter.\n\n${describeSummary(r.summary)}`
      }
      const shown = r.projects.slice(0, 40)
      const lines = shown.map((p) => `  • ${describeProject(p)}`).join('\n')
      const more =
        r.projects.length > shown.length ? `\n  …and ${r.projects.length - shown.length} more.` : ''
      return `${describeSummary(r.summary)}\n\nMatching (${r.projects.length}):\n${lines}${more}`
    },
  },

  {
    id: 'devtools.getProject',
    title: 'Get one project in detail',
    description:
      'Full metadata for a single project: language breakdown with percentages, frameworks, package manager, git branch and state, line count, size on disk with and without dependencies, README status, and whether it has tests. Accepts a project name, an absolute path, or an id.',
    risk: 'read',
    schema: z.object({
      project: z.string().describe('Project name, absolute path, or id.'),
    }),
    handler: async (args: { project: string }) => {
      const project = resolveProject(args.project)
      if (!project) {
        throw new CapabilityError(
          `No indexed project matches "${args.project}". Use devtools.listProjects to see what is indexed.`,
          'not_found'
        )
      }
      return project
    },
    formatResult: (p: ProjectWithFlags) => {
      const langs = Object.entries(p.languages)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([l, pct]) => `${l} ${pct}%`)
        .join(', ')

      return [
        `${p.name} — ${p.path}`,
        `Status: ${p.status} (source last touched ${formatAge(p.lastModified)}, last commit ${formatAge(p.lastCommitAt)})`,
        langs ? `Languages: ${langs}` : 'Languages: none recognised',
        p.frameworks.length ? `Frameworks: ${p.frameworks.join(', ')}` : 'Frameworks: none detected',
        `Package manager: ${p.packageManager ?? 'none'}`,
        `Git: ${p.branch ? `on ${p.branch}` : 'no branch'}${p.isDirty ? ', uncommitted changes' : ', clean'}${
          p.unpushedCount ? `, ${p.unpushedCount} unpushed` : ''
        }${p.remoteUrl ? `, remote ${p.remoteUrl}` : ', no remote'}`,
        `README: ${p.readmeStatus}. Tests: ${p.hasTests ? 'yes' : 'none found'}. ~${p.loc.toLocaleString()} lines.`,
        `Size: ${formatBytes(p.sizeBytes)} (${formatBytes(p.sizeBytesNoDeps)} excluding dependencies)`,
      ].join('\n')
    },
  },

  {
    id: 'devtools.openProject',
    title: 'Open a project',
    description:
      "Open a project in the user's file explorer, code editor, or a terminal window. Use when the user asks to open, show, or jump to a project.",
    // Launches a viewer on a path already in the index; it runs no command the
    // caller supplies and changes nothing on disk. Gating this behind an
    // approval prompt would train the reflex to approve without reading, which
    // is what has to work for the organiser and the shell.
    risk: 'read',
    schema: z.object({
      project: z.string().describe('Project name, absolute path, or id.'),
      target: z
        .enum(['explorer', 'editor', 'terminal'])
        .default('explorer')
        .describe('Where to open it.'),
    }),
    handler: async (args: { project: string; target: 'explorer' | 'editor' | 'terminal' }) => {
      const project = resolveProject(args.project)
      if (!project) {
        throw new CapabilityError(`No indexed project matches "${args.project}".`, 'not_found')
      }
      if (!existsSync(project.path)) {
        throw new CapabilityError(
          `${project.name} is indexed but ${project.path} no longer exists. Re-run a scan.`,
          'not_found'
        )
      }

      if (args.target === 'explorer') {
        await shell.openPath(project.path)
        return { opened: project.path, target: args.target }
      }

      // Fixed launchers, never a caller-supplied command. `detached` plus
      // unref'd stdio so a long-lived editor does not keep a handle on the
      // app, and closing REIGAN does not close the user's editor.
      const launcher =
        args.target === 'editor'
          ? { cmd: 'code', args: [project.path] }
          : { cmd: 'cmd.exe', args: ['/c', 'start', 'powershell.exe', '-NoExit', '-Command', `Set-Location -LiteralPath '${project.path.replace(/'/g, "''")}'`] }

      try {
        const child = spawn(launcher.cmd, launcher.args, {
          cwd: project.path,
          detached: true,
          stdio: 'ignore',
          shell: args.target === 'editor',
        })
        child.unref()
      } catch (err) {
        throw new CapabilityError(
          `Could not open ${project.name} in ${args.target}: ${(err as Error).message}`,
          'handler_failed'
        )
      }

      return { opened: project.path, target: args.target }
    },
    formatResult: (r: { opened: string; target: string }) =>
      `Opened ${r.opened} in ${r.target}.`,
  },

  {
    id: 'devtools.scanRoots',
    title: 'List configured scan roots',
    description:
      'Show which folders the project scanner searches. Useful when a project the user expects is missing from the index.',
    risk: 'read',
    schema: z.object({}),
    handler: async () => ({ roots: configuredRoots() }),
    formatResult: (r: { roots: string[] }) =>
      r.roots.length
        ? `Scanning: ${r.roots.join(', ')}`
        : 'No scan roots are configured and none of the usual folders exist.',
  },
]
