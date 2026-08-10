import { randomUUID } from 'crypto'
import { getDatabase } from '../../db/database'
import { decryptSecret, encryptSecret } from '../../db/secrets'

/**
 * Snippet & config vault.
 *
 * Secret bodies are encrypted at rest with the same safeStorage path the
 * credential settings use, and are excluded from the FTS index — an FTS table
 * stores its input verbatim, so indexing a secret body would write the
 * plaintext into a second table and undo the encryption entirely. Secret
 * snippets are therefore searchable by title, description and tags only.
 */

/** Keeping every revision forever turns the vault into an append-only log. */
const MAX_VERSIONS = 20

export interface Snippet {
  id: string
  title: string
  description: string | null
  language: string | null
  body: string
  tags: string[]
  isSecret: boolean
  useCount: number
  lastUsedAt: number | null
  createdAt: number
  updatedAt: number
  sourceProjectId: string | null
}

/** What leaves the main process for the model: never a secret body. */
export type RedactedSnippet = Omit<Snippet, 'body'> & {
  body: string
  bodyRedacted: boolean
}

export function redact(snippet: Snippet): RedactedSnippet {
  if (!snippet.isSecret) return { ...snippet, bodyRedacted: false }
  return {
    ...snippet,
    body: `[redacted — this snippet is marked secret. Its value can be copied to the clipboard or written to a file, but is never shown to the assistant.]`,
    bodyRedacted: true,
  }
}

function rowToSnippet(row: any): Snippet {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    language: row.language ?? null,
    body: row.is_secret ? decryptSecret(row.body) : row.body,
    tags: safeJson(row.tags_json, []),
    isSecret: !!row.is_secret,
    useCount: row.use_count ?? 0,
    lastUsedAt: row.last_used_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceProjectId: row.source_project_id ?? null,
  }
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function reindex(snippet: { id: string; title: string; description: string | null; tags: string[]; body: string; isSecret: boolean }): void {
  const db = getDatabase()
  db.prepare('DELETE FROM snippets_fts WHERE rowid = (SELECT rowid FROM snippets WHERE id = ?)').run(snippet.id)
  const rowid = (db.prepare('SELECT rowid FROM snippets WHERE id = ?').get(snippet.id) as any)?.rowid
  if (rowid === undefined) return
  db.prepare('INSERT INTO snippets_fts(rowid, title, description, tags, body) VALUES (?, ?, ?, ?, ?)').run(
    rowid,
    snippet.title,
    snippet.description ?? '',
    snippet.tags.join(' '),
    // The deliberate omission. Metadata is indexed; a secret body is not.
    snippet.isSecret ? '' : snippet.body
  )
}

export function createSnippet(params: {
  title: string
  body: string
  description?: string
  language?: string
  tags?: string[]
  isSecret?: boolean
  sourceProjectId?: string
}): Snippet {
  const db = getDatabase()
  const id = randomUUID()
  const now = Date.now()
  const isSecret = !!params.isSecret

  db.prepare(
    `INSERT INTO snippets
       (id, title, description, language, body, tags_json, is_secret, created_at, updated_at, source_project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.title,
    params.description ?? null,
    params.language ?? null,
    isSecret ? encryptSecret(params.body) : params.body,
    JSON.stringify(params.tags ?? []),
    isSecret ? 1 : 0,
    now,
    now,
    params.sourceProjectId ?? null
  )

  reindex({
    id,
    title: params.title,
    description: params.description ?? null,
    tags: params.tags ?? [],
    body: params.body,
    isSecret,
  })

  return getSnippet(id)!
}

export function updateSnippet(id: string, updates: { title?: string; body?: string; description?: string; language?: string; tags?: string[] }): Snippet {
  const db = getDatabase()
  const existing = getSnippet(id)
  if (!existing) throw new Error(`No snippet ${id}.`)

  if (updates.body !== undefined && updates.body !== existing.body) {
    db.prepare('INSERT INTO snippet_versions (id, snippet_id, body, saved_at) VALUES (?, ?, ?, ?)').run(
      randomUUID(),
      id,
      existing.isSecret ? encryptSecret(existing.body) : existing.body,
      Date.now()
    )
    db.prepare(
      `DELETE FROM snippet_versions
       WHERE snippet_id = ? AND id NOT IN (
         SELECT id FROM snippet_versions WHERE snippet_id = ? ORDER BY saved_at DESC LIMIT ?
       )`
    ).run(id, id, MAX_VERSIONS)
  }

  const next = {
    title: updates.title ?? existing.title,
    description: updates.description ?? existing.description,
    language: updates.language ?? existing.language,
    body: updates.body ?? existing.body,
    tags: updates.tags ?? existing.tags,
  }

  db.prepare(
    `UPDATE snippets SET title = ?, description = ?, language = ?, body = ?, tags_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    next.title,
    next.description,
    next.language,
    existing.isSecret ? encryptSecret(next.body) : next.body,
    JSON.stringify(next.tags),
    Date.now(),
    id
  )

  reindex({ id, ...next, isSecret: existing.isSecret })
  return getSnippet(id)!
}

export function getSnippet(id: string): Snippet | null {
  const row = getDatabase().prepare('SELECT * FROM snippets WHERE id = ?').get(id) as any
  return row ? rowToSnippet(row) : null
}

export function markUsed(id: string): void {
  getDatabase()
    .prepare('UPDATE snippets SET use_count = use_count + 1, last_used_at = ? WHERE id = ?')
    .run(Date.now(), id)
}

export function searchSnippets(query: string, limit = 25): Snippet[] {
  const db = getDatabase()
  if (!query.trim()) {
    const rows = db
      .prepare('SELECT * FROM snippets ORDER BY last_used_at DESC NULLS LAST, updated_at DESC LIMIT ?')
      .all(limit) as any[]
    return rows.map(rowToSnippet)
  }

  try {
    const rows = db
      .prepare(
        `SELECT s.* FROM snippets_fts f
         JOIN snippets s ON s.rowid = f.rowid
         WHERE snippets_fts MATCH ?
         ORDER BY rank LIMIT ?`
      )
      .all(toFtsQuery(query), limit) as any[]
    return rows.map(rowToSnippet)
  } catch {
    // FTS5 rejects some user input as a malformed match expression; a LIKE
    // fallback keeps search working rather than surfacing a syntax error.
    const rows = db
      .prepare(
        `SELECT * FROM snippets WHERE title LIKE ? OR description LIKE ? ORDER BY updated_at DESC LIMIT ?`
      )
      .all(`%${query}%`, `%${query}%`, limit) as any[]
    return rows.map(rowToSnippet)
  }
}

/** Quotes each term so punctuation cannot be read as FTS5 syntax. */
function toFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '')}"*`)
    .join(' ')
}

export function listVersions(snippetId: string): Array<{ id: string; savedAt: number }> {
  return getDatabase()
    .prepare('SELECT id, saved_at FROM snippet_versions WHERE snippet_id = ? ORDER BY saved_at DESC')
    .all(snippetId)
    .map((r: any) => ({ id: r.id, savedAt: r.saved_at }))
}

export function deleteSnippet(id: string): void {
  const db = getDatabase()
  db.prepare('DELETE FROM snippets_fts WHERE rowid = (SELECT rowid FROM snippets WHERE id = ?)').run(id)
  db.prepare('DELETE FROM snippets WHERE id = ?').run(id)
}
