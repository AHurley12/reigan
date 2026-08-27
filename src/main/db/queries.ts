import { getDatabase } from './database'
import { decryptSecret, encryptSecret, isSecretKey } from './secrets'
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

/** Returns the new row's id, so a caller can address the message it just wrote. */
export function saveMessage(params: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
}): string {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  db.prepare('INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)').run(
    id, params.conversationId, params.role, params.content, now
  )
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, params.conversationId)
  return id
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export function getMessages(conversationId: string): StoredMessage[] {
  const db = getDatabase()
  // Columns named explicitly rather than `SELECT *`. The old form returned the
  // raw row — snake_case `conversation_id` and all — behind a declared type
  // that said otherwise, so the type was a lie the moment anything read it.
  const rows = db
    .prepare(
      `SELECT id, role, content, timestamp
         FROM messages
        WHERE conversation_id = ?
        ORDER BY timestamp ASC, rowid ASC`
    )
    .all(conversationId) as Array<{ id: string; role: string; content: string; timestamp: number }>

  // `rowid` breaks ties: a user turn and its reply can land in the same
  // millisecond, and without a tiebreaker the reply can sort above the question.
  // The `system` role is allowed by the table's CHECK but is never written and
  // has no renderer representation, so it is filtered rather than mis-rendered.
  return rows
    .filter((r): r is StoredMessage => r.role === 'user' || r.role === 'assistant')
    .map((r) => ({ id: r.id, role: r.role, content: r.content, timestamp: r.timestamp }))
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export function listConversations(params: { limit?: number; offset?: number; search?: string } = {}): ConversationSummary[] {
  const db = getDatabase()
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
  const offset = Math.max(params.offset ?? 0, 0)
  const search = params.search?.trim()

  const where = search ? 'WHERE c.title LIKE ? ESCAPE \'\\\'' : ''
  const args: unknown[] = search ? [`%${escapeLike(search)}%`] : []

  const rows = db
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
         ${where}
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(...args, limit, offset) as Array<{
      id: string; title: string; created_at: number; updated_at: number; message_count: number
    }>

  return rows.map(rowToConversation)
}

export function getConversation(id: string): ConversationSummary | null {
  const db = getDatabase()
  const row = db
    .prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
         FROM conversations c
        WHERE c.id = ?`
    )
    .get(id) as { id: string; title: string; created_at: number; updated_at: number; message_count: number } | undefined

  return row ? rowToConversation(row) : null
}

/** False when no such conversation exists, so a caller can report that honestly. */
export function renameConversation(id: string, title: string): boolean {
  const db = getDatabase()
  const result = db
    .prepare('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?')
    .run(title, Date.now(), id)
  return result.changes > 0
}

/** Messages go with it: the foreign key declares ON DELETE CASCADE and
 *  database.ts enables `foreign_keys`, so this is one statement, not two. */
export function deleteConversation(id: string): boolean {
  const db = getDatabase()
  return db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0
}

function rowToConversation(row: {
  id: string; title: string; created_at: number; updated_at: number; message_count: number
}): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count,
  }
}

/** `%` and `_` are wildcards in LIKE; a title search for "50%" must not match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// ── Settings ──

export function getSetting(key: string): string | null {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
  if (!row) return null
  // Credential rows are encrypted at rest (see db/secrets.ts). Decryption is
  // transparent here so every existing caller keeps working unchanged, and rows
  // written by builds that predate encryption pass through untouched.
  return isSecretKey(key) ? decryptSecret(row.value) : row.value
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
  const stored = isSecretKey(key) ? encryptSecret(value) : value
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, stored)
}

/**
 * Every setting, credentials decrypted. **Main process only.**
 *
 * Do not hand the result to the renderer — see `getSettingsForRenderer()`.
 */
export function getAllSettings(): Record<string, string> {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  return Object.fromEntries(
    rows.map((r) => [r.key, isSecretKey(r.key) ? decryptSecret(r.value) : r.value])
  )
}

/**
 * The renderer's view: identical, except credential values are blanked.
 *
 * Encrypting secrets at rest accomplishes little while the renderer is still
 * handed the plaintext at startup — the database stops being the soft target
 * and the renderer heap becomes one instead, reachable by any compromised
 * dependency in the React tree. The renderer has no legitimate use for these
 * values: it displays them masked and posts replacements back. So it gets an
 * empty string and, separately, a preview (see `getSecretPreviews()`).
 *
 * Blank rather than a mask string on purpose. A mask that round-trips through
 * a save would overwrite the real key with bullet characters; an empty value
 * is unambiguous, and the save path already treats it as "no change".
 */
export function getSettingsForRenderer(): Record<string, string> {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  return Object.fromEntries(rows.map((r) => [r.key, isSecretKey(r.key) ? '' : r.value]))
}

export interface SecretPreview {
  hasValue: boolean
  /** Last 4 characters, enough to recognise a key without disclosing it. */
  last4: string
}

/**
 * What the UI needs to say "a key is saved, and it ends 4f2a" without ever
 * holding the key. Four characters is not enough to be useful to an attacker
 * and is enough for the user to tell two of their own keys apart.
 */
export function getSecretPreviews(): Record<string, SecretPreview> {
  const db = getDatabase()
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const out: Record<string, SecretPreview> = {}
  for (const row of rows) {
    if (!isSecretKey(row.key)) continue
    const plain = decryptSecret(row.value)
    // Values arrive JSON-encoded from the renderer; strip the quotes so the
    // preview reflects the key itself rather than a trailing `"`.
    const unwrapped = unwrapJsonString(plain)
    out[row.key] = {
      hasValue: unwrapped.length > 0,
      last4: unwrapped.length > 4 ? unwrapped.slice(-4) : '',
    }
  }
  return out
}

function unwrapJsonString(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : raw
  } catch {
    return raw
  }
}
