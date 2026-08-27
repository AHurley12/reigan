import { app } from 'electron'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getDatabase } from '../db/database'
import { checkAttachment, type AttachmentKind } from '../../shared/attachmentPolicy'
import type { ChatAttachmentInput, ChatAttachmentMeta } from '../../shared/types'

export type StoredAttachment = ChatAttachmentMeta
export type IncomingAttachment = ChatAttachmentInput

const EXTENSION: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
}

function attachmentsDir(): string {
  const dir = join(app.getPath('userData'), 'attachments')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Persists the attachments that came in with one message.
 *
 * The renderer has already run the same policy, but that check is a courtesy to
 * the person dropping the file — this one is the one that counts. Anything the
 * policy refuses is skipped rather than throwing, so one bad file cannot cost
 * the user the whole message they just sent.
 */
export function saveAttachments(messageId: string, incoming: IncomingAttachment[]): StoredAttachment[] {
  if (incoming.length === 0) return []

  const db = getDatabase()
  const dir = attachmentsDir()
  const saved: StoredAttachment[] = []
  const accepted: Array<{ name: string; mimeType: string; byteSize: number }> = []

  const insert = db.prepare(
    `INSERT INTO message_attachments
       (id, message_id, kind, mime_type, filename, byte_size, path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )

  for (const item of incoming) {
    const bytes = Buffer.from(item.data, 'base64')
    const candidate = { name: item.filename, mimeType: item.mimeType, byteSize: bytes.byteLength }

    const verdict = checkAttachment(candidate, accepted)
    if (!verdict.ok) continue

    const id = randomUUID()
    const path = join(dir, `${id}${EXTENSION[item.mimeType] ?? ''}`)
    writeFileSync(path, bytes)

    insert.run(id, messageId, verdict.kind, item.mimeType, item.filename, bytes.byteLength, path, Date.now())
    accepted.push(candidate)
    saved.push({
      id,
      messageId,
      kind: verdict.kind,
      mimeType: item.mimeType,
      filename: item.filename,
      byteSize: bytes.byteLength,
    })
  }

  return saved
}

export function getAttachmentsForConversation(conversationId: string): StoredAttachment[] {
  const db = getDatabase()
  const rows = db
    .prepare(
      `SELECT a.id, a.message_id, a.kind, a.mime_type, a.filename, a.byte_size
         FROM message_attachments a
         JOIN messages m ON m.id = a.message_id
        WHERE m.conversation_id = ?
        ORDER BY a.created_at ASC`
    )
    .all(conversationId) as Array<{
      id: string; message_id: string; kind: AttachmentKind
      mime_type: string; filename: string; byte_size: number
    }>

  return rows.map((r) => ({
    id: r.id,
    messageId: r.message_id,
    kind: r.kind,
    mimeType: r.mime_type,
    filename: r.filename,
    byteSize: r.byte_size,
  }))
}

/**
 * Deletes attachment files with no surviving row.
 *
 * Deleting a conversation cascades the rows away, but SQLite cannot unlink the
 * files those rows pointed at. Without this, every deleted conversation leaks
 * its images and PDFs onto disk permanently.
 *
 * Returns the number of files removed. Never throws: a locked or already-gone
 * file must not stop the app from starting.
 */
export function pruneOrphanAttachments(): number {
  try {
    const dir = attachmentsDir()
    const db = getDatabase()
    const known = new Set(
      (db.prepare('SELECT path FROM message_attachments').all() as Array<{ path: string }>).map((r) => r.path)
    )

    let removed = 0
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (known.has(path)) continue
      try {
        unlinkSync(path)
        removed += 1
      } catch {
        // In use, or gone already. Either way it is not worth failing startup.
      }
    }
    return removed
  } catch {
    return 0
  }
}
