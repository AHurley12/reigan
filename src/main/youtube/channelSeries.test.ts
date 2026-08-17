import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-series-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { getChannelSeries } = await import('./queries')

const DAY = 86_400_000
const isoDay = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)

function addStats(row: {
  videoId: string
  daysAgo: number
  views?: number
  likes?: number
  comments?: number
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_daily_stats
         (video_id, date, views, watch_time_minutes, avg_view_duration_s, avg_view_percentage,
          subs_gained, subs_lost, impressions, ctr, likes, comments)
       VALUES (?, ?, ?, 10, 60, 40, 2, 1, 0, 0, ?, ?)`
    )
    .run(row.videoId, isoDay(row.daysAgo), row.views ?? 0, row.likes ?? 0, row.comments ?? 0)
}

beforeEach(() => {
  const db = getDatabase()
  db.prepare('DELETE FROM yt_daily_stats').run()
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('getChannelSeries', () => {
  it('sums likes and comments across videos for each day', () => {
    // Two videos on the same day: the series is a channel total, so both rows
    // have to land in one point rather than producing two.
    addStats({ videoId: 'a', daysAgo: 1, views: 100, likes: 8, comments: 2 })
    addStats({ videoId: 'b', daysAgo: 1, views: 250, likes: 11, comments: 5 })
    addStats({ videoId: 'a', daysAgo: 2, views: 90, likes: 4, comments: 1 })

    const series = getChannelSeries(28)

    expect(series).toHaveLength(2)
    expect(series.map((p) => p.date)).toEqual([isoDay(2), isoDay(1)])

    const [older, newer] = series
    expect(older).toMatchObject({ views: 90, likes: 4, comments: 1 })
    expect(newer).toMatchObject({ views: 350, likes: 19, comments: 7 })
  })

  it('reports zero engagement rather than dropping days that predate the columns', () => {
    // Migration 14 backfills nothing: rows written before it carry the 0
    // default. Those days must still appear in the series — a gap would read as
    // "the channel was dark", which is a different claim from "not collected".
    addStats({ videoId: 'a', daysAgo: 3, views: 500 })

    const [point] = getChannelSeries(28)

    expect(point.views).toBe(500)
    expect(point.likes).toBe(0)
    expect(point.comments).toBe(0)
  })

  it('excludes days outside the requested window', () => {
    addStats({ videoId: 'a', daysAgo: 2, views: 10, likes: 1, comments: 1 })
    addStats({ videoId: 'a', daysAgo: 40, views: 999, likes: 99, comments: 99 })

    const series = getChannelSeries(28)

    expect(series).toHaveLength(1)
    expect(series[0].views).toBe(10)
  })
})
