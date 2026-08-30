import { z } from 'zod'
import { createTask, deleteTask, getTaskById, listTasks, updateTask } from '../../db/queries'
import type { AnyCapability } from '../types'

/**
 * Tasks, as capabilities.
 *
 * This is the migration proof for the registry: previously the same five
 * operations existed twice — once as IPC handlers in `ipc/tasks.ts` for the UI,
 * once as LangChain tools in `agents/tools/taskTools.ts` for the model — sharing
 * only `db/queries.ts`. Here each is declared once and reaches both surfaces.
 *
 * It also exercises every tier the registry enforces: a `read`, a `write` with a
 * computed before/after diff, and a `destructive`.
 */

const statusEnum = z.enum(['backlog', 'active', 'review', 'done'])
const priorityEnum = z.enum(['low', 'medium', 'high', 'critical'])

const listSchema = z.object({
  status: statusEnum.optional().describe('Only return tasks in this status'),
  priority: priorityEnum.optional().describe('Only return tasks at this priority'),
})

const createSchema = z.object({
  title: z.string().min(1).describe('The task title'),
  description: z.string().optional().describe('Optional detailed description'),
  priority: priorityEnum.optional().describe('Task priority level'),
  status: statusEnum.optional().describe('Initial task status'),
  dueDate: z.number().optional().describe('Due date as a Unix timestamp in milliseconds'),
})

const updateSchema = z.object({
  id: z.string().describe('The task id to update'),
  title: z.string().optional(),
  description: z.string().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  dueDate: z.number().optional(),
})

const idSchema = z.object({ id: z.string().describe('The task id') })

export const taskCapabilities: AnyCapability[] = [
  {
    id: 'tasks.list',
    title: 'List tasks',
    description:
      'List the user\'s tasks, optionally filtered by status or priority. Use when the user asks what tasks they have.',
    risk: 'read',
    schema: listSchema,
    handler: (args: z.infer<typeof listSchema>) => listTasks(args),
    formatResult: (tasks: ReturnType<typeof listTasks>) => {
      if (tasks.length === 0) return 'No tasks found.'
      return tasks
        .map((t) => {
          const due = t.dueDate ? ` (due: ${new Date(t.dueDate).toLocaleDateString()})` : ''
          return `• [${t.status}] ${t.title}${due} — ${t.priority} priority (id: ${t.id})`
        })
        .join('\n')
    },
  },

  {
    id: 'tasks.create',
    title: 'Create task',
    description:
      'Create a new task. Use when the user asks to add, create, or remember a task.',
    risk: 'write',
    schema: createSchema,
    approval: {
      summary: (args: z.infer<typeof createSchema>) => `Create task "${args.title}"`,
      diff: (args: z.infer<typeof createSchema>) => ({
        subject: args.title,
        changes: [
          { field: 'status', before: null, after: args.status ?? 'backlog' },
          { field: 'priority', before: null, after: args.priority ?? 'medium' },
          ...(args.dueDate
            ? [{ field: 'due', before: null, after: new Date(args.dueDate).toLocaleDateString() }]
            : []),
        ],
      }),
    },
    handler: (args: z.infer<typeof createSchema>) => createTask(args),
    formatResult: (task: ReturnType<typeof createTask>) =>
      `Task created: "${task.title}" (${task.priority} priority, status: ${task.status}, id: ${task.id})`,
  },

  {
    id: 'tasks.update',
    title: 'Update task',
    description:
      'Update an existing task by id — change its status, priority, title, description, or due date.',
    risk: 'write',
    schema: updateSchema,
    approval: {
      summary: ({ id, ...rest }: z.infer<typeof updateSchema>) =>
        rest.title ? `Update task ${id} — "${rest.title}"` : `Update task ${id}`,
      // A real before/after, read from the database at prompt time. The old flat
      // `detail` string could only echo the requested values, so the user saw
      // what would be written but never what it replaced.
      diff: ({ id, ...updates }: z.infer<typeof updateSchema>) => {
        const existing = getTaskById(id)
        if (!existing) return null
        const fields = Object.entries(updates).filter(([, v]) => v !== undefined)
        return {
          subject: existing.title,
          changes: fields.map(([field, after]) => ({
            field,
            before: formatField(existing[field as keyof typeof existing]),
            after: formatField(after),
          })),
        }
      },
    },
    handler: ({ id, ...updates }: z.infer<typeof updateSchema>) => {
      const task = updateTask(id, updates)
      if (!task) throw new Error(`Task ${id} not found.`)
      return task
    },
    formatResult: (task: { title: string; status: string; priority: string }) =>
      `Updated task: "${task.title}" — status: ${task.status}, priority: ${task.priority}`,
  },

  {
    id: 'tasks.complete',
    title: 'Complete task',
    description: 'Mark a task as done. Use when the user says they finished or completed a task.',
    risk: 'write',
    schema: idSchema,
    approval: {
      summary: ({ id }: z.infer<typeof idSchema>) => {
        const task = getTaskById(id)
        return task ? `Mark "${task.title}" as done` : `Mark task ${id} as done`
      },
    },
    handler: ({ id }: z.infer<typeof idSchema>) => {
      const task = updateTask(id, { status: 'done', completedAt: Date.now() })
      if (!task) throw new Error(`Task ${id} not found.`)
      return task
    },
    formatResult: (task: { title: string }) => `Completed: "${task.title}" — 完了 (kanryou)`,
  },

  {
    id: 'tasks.delete',
    title: 'Delete task',
    description: 'Permanently delete a task by id. Use when the user asks to remove or delete a task.',
    risk: 'destructive',
    schema: idSchema,
    approval: {
      summary: ({ id }: z.infer<typeof idSchema>) => {
        const task = getTaskById(id)
        return task ? `Permanently delete "${task.title}"` : `Permanently delete task ${id}`
      },
      diff: ({ id }: z.infer<typeof idSchema>) => {
        const task = getTaskById(id)
        if (!task) return null
        return {
          subject: task.title,
          changes: [
            { field: 'status', before: task.status, after: null },
            { field: 'priority', before: task.priority, after: null },
          ],
        }
      },
    },
    handler: ({ id }: z.infer<typeof idSchema>) => {
      deleteTask(id)
      return { id }
    },
    formatResult: ({ id }: { id: string }) => `Deleted task ${id}.`,
  },
]

function formatField(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) return value.join(', ') || null
  return String(value)
}
