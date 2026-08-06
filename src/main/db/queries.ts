import { getDatabase } from './database'
import { Task, TaskStatus, TaskPriority } from '../../shared/types'
import { randomUUID } from 'crypto'

// ── Tasks ──

export function createTask(params: {
  title: string
  description?: string
  status?: TaskStatus
  priority?: TaskPriority
  dueDate?: number
  tags?: string[]
}): Task {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  const tags = JSON.stringify(params.tags ?? [])

  db.prepare(`
    INSERT INTO tasks (id, title, description, status, priority, due_date, created_at, updated_at, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.title,
    params.description ?? null,
    params.status ?? 'backlog',
    params.priority ?? 'medium',
    params.dueDate ?? null,
    now,
    now,
    tags
  )

  return getTaskById(id)!
}

export function getTaskById(id: string): Task | null {
  const db = getDatabase()
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any
  return row ? rowToTask(row) : null
}

export function listTasks(params?: { status?: TaskStatus; priority?: TaskPriority }): Task[] {
  const db = getDatabase()
  let query = 'SELECT * FROM tasks'
  const conditions: string[] = []
  const values: any[] = []

  if (params?.status) {
    conditions.push('status = ?')
    values.push(params.status)
  }
  if (params?.priority) {
    conditions.push('priority = ?')
    values.push(params.priority)
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ')
  }
  query += ' ORDER BY created_at DESC'

  const rows = db.prepare(query).all(...values) as any[]
  return rows.map(rowToTask)
}

export function updateTask(id: string, updates: Partial<Omit<Task, 'id' | 'createdAt'>>): Task | null {
  const db = getDatabase()
  const now = Date.now()
  const fields: string[] = ['updated_at = ?']
  const values: any[] = [now]

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title) }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority) }
  if (updates.dueDate !== undefined) { fields.push('due_date = ?'); values.push(updates.dueDate) }
  if (updates.completedAt !== undefined) { fields.push('completed_at = ?'); values.push(updates.completedAt) }
  if (updates.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(updates.tags)) }

  values.push(id)
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getTaskById(id)
}

export function deleteTask(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    dueDate: row.due_date ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at ?? undefined,
    tags: JSON.parse(row.tags ?? '[]'),
  }
}

// ── Conversations & Messages ──

export function createConversation(title = 'New Conversation'): string {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, title, now, now)
  return id
}

export function saveMessage(params: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
}): void {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(
    id, params.conversationId, params.role, params.content, now
  )
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, params.conversationId)
}

export function getMessages(conversationId: string): Array<{ id: string; role: string; content: string; timestamp: number }> {
  const db = getDatabase()
  return db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC').all(conversationId) as any[]
}

// ── Settings ──

export function getSetting(key: string): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
  return row ? row.value : null
}

// Renderer settings are JSON-encoded before being sent over IPC (settingsStore.ts)
// so numbers/booleans round-trip with their type. Callers reading a string-valued
// setting directly (bypassing the renderer's decode step) need this to strip the
// resulting wrapping quotes. Only unwraps actual JSON strings; anything else
// (legacy unquoted rows, JSON objects like googleTokens) passes through unchanged.
export function getDecodedSetting(key: string): string | null {
  const raw = getSetting(key)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : raw
  } catch {
    return raw
  }
}

export function setSetting(key: string, value: string): void {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
}

export function getAllSettings(): Record<string, string> {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
