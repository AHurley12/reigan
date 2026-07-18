import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { createTask, listTasks, updateTask, deleteTask } from '../../db/queries'

export const createTaskTool = new DynamicStructuredTool({
  name: 'create_task',
  description: 'Create a new task for the user. Use when the user asks to add, create, or remember a task.',
  schema: z.object({
    title: z.string().describe('The task title'),
    description: z.string().optional().describe('Optional detailed description'),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('Task priority level'),
    status: z.enum(['backlog', 'active', 'review', 'done']).optional().describe('Initial task status'),
    dueDate: z.number().optional().describe('Due date as Unix timestamp in milliseconds'),
  }),
  func: async (input) => {
    const task = createTask(input)
    return `Task created: "${task.title}" (${task.priority} priority, status: ${task.status}, id: ${task.id})`
  },
})

export const listTasksTool = new DynamicStructuredTool({
  name: 'list_tasks',
  description: 'List tasks, optionally filtered by status or priority. Use when user asks what tasks they have.',
  schema: z.object({
    status: z.enum(['backlog', 'active', 'review', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  }),
  func: async (input) => {
    const tasks = listTasks(input)
    if (tasks.length === 0) return 'No tasks found.'
    return tasks.map(t => {
      const due = t.dueDate ? ` (due: ${new Date(t.dueDate).toLocaleDateString()})` : ''
      return `• [${t.status}] ${t.title}${due} — ${t.priority} priority (id: ${t.id})`
    }).join('\n')
  },
})

export const updateTaskTool = new DynamicStructuredTool({
  name: 'update_task',
  description: 'Update an existing task by id. Use to change status, priority, title, or due date.',
  schema: z.object({
    id: z.string().describe('The task id to update'),
    title: z.string().optional(),
    status: z.enum(['backlog', 'active', 'review', 'done']).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    dueDate: z.number().optional(),
    description: z.string().optional(),
  }),
  func: async ({ id, ...updates }) => {
    const task = updateTask(id, updates)
    if (!task) return `Task ${id} not found.`
    return `Updated task: "${task.title}" — status: ${task.status}, priority: ${task.priority}`
  },
})

export const completeTaskTool = new DynamicStructuredTool({
  name: 'complete_task',
  description: 'Mark a task as done. Use when user says they finished or completed a task.',
  schema: z.object({
    id: z.string().describe('The task id to complete'),
  }),
  func: async ({ id }) => {
    const task = updateTask(id, { status: 'done', completedAt: Date.now() })
    if (!task) return `Task ${id} not found.`
    return `Completed: "${task.title}" — 完了 (kanryou)`
  },
})
