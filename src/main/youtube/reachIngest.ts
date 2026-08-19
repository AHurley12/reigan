import { getDatabase } from '../db/database'
import type { ReachRow } from './reachCsv'

/**
 * Writes reach rows into `yt_daily_stats`, touching only the two columns the
 * Reporting API owns.
 *
 * Rows for videos absent from `yt_videos` are dropped rather than inserted:
 * reports cover deleted and private videos too, and orphan stat rows would
 * survive every catalog cleanup with nothing to join them back to.
 */
export function ingestReachRows(rows: ReachRow[]): { written: number; skipped: number } {
  const db = getDatabase()

  const known = new Set(
    (db.prepare('SELECT id FROM yt_videos').all() as Array<{ id: string }>).map((r) => r.id)
  )

  const upsert = db.prepare(
    `INSERT INTO yt_daily_stats (video_id, date, impressions, ctr)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(video_id, date) DO UPDATE SET
       impressions = excluded.impressions, ctr = excluded.ctr`
  )

  let written = 0
  let skipped = 0

  db.transaction(() => {
    for (const row of rows) {
      if (!known.has(row.videoId)) {
        skipped++
        continue
      }
      upsert.run(row.videoId, row.date, row.impressions, row.ctr)
      written++
    }
  })()

  return { written, skipped }
}
