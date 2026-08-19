import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-ingest-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { ingestReachRows } = await import('./reachIngest')
// The sync's real statement, not a copy of it: a copy would keep passing after
// someone re-added `impressions = excluded.impressions` to the one that ships.
const { DAILY_STATS_UPSERT_SQL } = await import('./sync')

function addVideo(id: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_videos
         (id, title, description, published_at, duration_s, privacy_status, thumbnail_url,
          has_custom_thumbnail, tags_json, category_id, view_count, like_count, comment_count, synced_at)
       VALUES (?, 'T', 'd', ?, 600, 'public', null, 1, '[]', '22', 100, 0, 0, ?)`
    )
    .run(id, Date.now(), Date.now())
}

function addStatRow(videoId: string, date: string, views: number): void {
  getDatabase()
    .prepare('INSERT INTO yt_daily_stats (video_id, date, views) VALUES (?, ?, ?)')
    .run(videoId, date, views)
}

const statRow = (videoId: string, date: string) =>
  getDatabase()
    .prepare('SELECT * FROM yt_daily_stats WHERE video_id = ? AND date = ?')
    .get(videoId, date) as { views: number; impressions: number; ctr: number } | undefined

beforeEach(() => {
  getDatabase().exec('DELETE FROM yt_videos; DELETE FROM yt_daily_stats;')
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ingestReachRows', () => {
  it('adds impressions to a day the sync already wrote, leaving views alone', () => {
    addVideo('vid-a')
    addStatRow('vid-a', '2026-08-15', 120)

    const result = ingestReachRows([
      { date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.03 },
    ])

    expect(result).toEqual({ written: 1, skipped: 0 })
    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ views: 120, impressions: 4000, ctr: 0.03 })
  })

  it('creates a row for a day the sync never wrote', () => {
    // A day with impressions and no views is not noise — it is exactly the
    // signal revival_thumbnail exists to catch.
    addVideo('vid-a')

    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 900, ctr: 0.01 }])

    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ views: 0, impressions: 900 })
  })

  it('skips a video that is not in the catalog', () => {
    const result = ingestReachRows([
      { date: '2026-08-15', videoId: 'deleted-vid', impressions: 900, ctr: 0.01 },
    ])

    expect(result).toEqual({ written: 0, skipped: 1 })
    expect(statRow('deleted-vid', '2026-08-15')).toBeUndefined()
  })

  it('overwrites an earlier value when a corrected report arrives', () => {
    addVideo('vid-a')
    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 900, ctr: 0.01 }])
    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 1500, ctr: 0.02 }])

    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ impressions: 1500, ctr: 0.02 })
  })

  it('survives the channel sync writing the same day', () => {
    // The regression this whole design turns on: the sync writes 0 into
    // impressions and ctr, so if its upsert owns those columns it erases every
    // ingested value on the next nightly run.
    addVideo('vid-a')
    ingestReachRows([{ date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.03 }])

    getDatabase()
      .prepare(DAILY_STATS_UPSERT_SQL)
      .run('vid-a', '2026-08-15', 200, 40, 60, 50, 1, 0, 0, 0, 3, 1)

    expect(statRow('vid-a', '2026-08-15')).toMatchObject({ views: 200, impressions: 4000, ctr: 0.03 })
  })
})
