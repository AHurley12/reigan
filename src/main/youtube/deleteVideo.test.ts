import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-del-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { deleteVideoFromCache } = await import('./queries')

function addVideo(id: string, title: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_videos
         (id, title, description, published_at, duration_s, privacy_status, thumbnail_url,
          has_custom_thumbnail, tags_json, category_id, view_count, like_count, comment_count, synced_at)
       VALUES (?, ?, 'd', ?, 600, 'public', null, 1, '[]', '22', 100, 0, 0, ?)`
    )
    .run(id, title, Date.now(), Date.now())

  getDatabase()
    .prepare(
      `INSERT INTO yt_daily_stats (video_id, date, views) VALUES (?, '2026-08-01', 10)`
    )
    .run(id)

  getDatabase()
    .prepare(
      `INSERT INTO yt_traffic_sources (video_id, date, source_type, views)
       VALUES (?, '2026-08-01', 'SUGGESTED_VIDEO', 7)`
    )
    .run(id)
}

const count = (table: string, id: string): number =>
  (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${table === 'yt_videos' ? 'id' : 'video_id'} = ?`)
      .get(id) as { n: number }
  ).n

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('deleteVideoFromCache', () => {
  beforeEach(() => {
    getDatabase().exec('DELETE FROM yt_videos; DELETE FROM yt_daily_stats; DELETE FROM yt_traffic_sources;')
  })

  it('removes the video row', () => {
    addVideo('vid-1', 'Doomed')

    deleteVideoFromCache('vid-1')

    expect(count('yt_videos', 'vid-1')).toBe(0)
  })

  it('removes the analytics rows the video leaves behind', () => {
    // Neither child table declares a foreign key to yt_videos, so nothing
    // cascades. Left alone these rows are unreachable but still counted by
    // anything that aggregates across the stats tables.
    addVideo('vid-1', 'Doomed')

    deleteVideoFromCache('vid-1')

    expect(count('yt_daily_stats', 'vid-1')).toBe(0)
    expect(count('yt_traffic_sources', 'vid-1')).toBe(0)
  })

  it('leaves other videos untouched', () => {
    addVideo('vid-1', 'Doomed')
    addVideo('vid-2', 'Survivor')

    deleteVideoFromCache('vid-1')

    expect(count('yt_videos', 'vid-2')).toBe(1)
    expect(count('yt_daily_stats', 'vid-2')).toBe(1)
    expect(count('yt_traffic_sources', 'vid-2')).toBe(1)
  })
})
