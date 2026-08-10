import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-'))
process.env.REIGAN_TEST_USERDATA = tempDir

const { getDatabase, closeDatabase } = await import('../db/database')
const { runCatalogAudit, median, pearson } = await import('./audit')

const DAY = 86_400_000
const isoDay = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)

function addVideo(params: {
  id: string
  title: string
  ageDays: number
  lifetimeViews: number
  description?: string
  tags?: string[]
  customThumbnail?: boolean
}): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_videos
         (id, title, description, published_at, duration_s, privacy_status, thumbnail_url,
          has_custom_thumbnail, tags_json, category_id, view_count, like_count, comment_count, synced_at)
       VALUES (?, ?, ?, ?, 600, 'public', null, ?, ?, '22', ?, 0, 0, ?)`
    )
    .run(
      params.id,
      params.title,
      params.description ?? 'x'.repeat(300),
      Date.now() - params.ageDays * DAY,
      params.customThumbnail === false ? 0 : 1,
      JSON.stringify(params.tags ?? ['tag']),
      params.lifetimeViews,
      Date.now()
    )
}

function addDailyStats(
  videoId: string,
  days: number,
  perDay: { views: number; impressions?: number; ctr?: number; avp?: number }
): void {
  const stmt = getDatabase().prepare(
    `INSERT OR REPLACE INTO yt_daily_stats
       (video_id, date, views, watch_time_minutes, avg_view_duration_s, avg_view_percentage,
        subs_gained, subs_lost, impressions, ctr)
     VALUES (?, ?, ?, ?, 0, ?, 0, 0, ?, ?)`
  )
  for (let i = 0; i < days; i++) {
    stmt.run(
      videoId,
      isoDay(i),
      perDay.views,
      perDay.views * 2,
      perDay.avp ?? 50,
      perDay.impressions ?? 0,
      perDay.ctr ?? 0
    )
  }
}

function addTraffic(videoId: string, sources: Record<string, number>): void {
  const stmt = getDatabase().prepare(
    'INSERT OR REPLACE INTO yt_traffic_sources (video_id, date, source_type, views) VALUES (?, ?, ?, ?)'
  )
  for (const [type, views] of Object.entries(sources)) stmt.run(videoId, isoDay(0), type, views)
}

beforeEach(() => {
  const db = getDatabase()
  db.exec(
    'DELETE FROM yt_videos; DELETE FROM yt_daily_stats; DELETE FROM yt_traffic_sources; DELETE FROM yt_audit_findings;'
  )
})

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('still-earning detection', () => {
  it('flags a mature video still pulling near its lifetime rate', () => {
    // 400 days old, 4,000 lifetime views → 10/day lifetime. Currently 12/day.
    addVideo({ id: 'evergreen', title: 'Evergreen tutorial', ageDays: 400, lifetimeViews: 4000 })
    addDailyStats('evergreen', 28, { views: 12 })
    addTraffic('evergreen', { YT_SEARCH: 900, RELATED_VIDEO: 100 })

    const finding = runCatalogAudit().find((f) => f.kind === 'still_earning')

    expect(finding).toBeDefined()
    expect(finding!.videoId).toBe('evergreen')
    expect(finding!.evidence.trafficClass).toBe('search')
    expect(finding!.detail).toMatch(/evergreen and worth reviving/)
  })

  it('ignores a video whose traffic has collapsed since launch', () => {
    // 10/day lifetime, now 1/day — a dead launch spike.
    addVideo({ id: 'dead', title: 'Old news', ageDays: 400, lifetimeViews: 4000 })
    addDailyStats('dead', 28, { views: 1 })

    expect(runCatalogAudit().some((f) => f.kind === 'still_earning')).toBe(false)
  })

  it('ignores a video too young to judge', () => {
    // A 10-day-old video is always "at its lifetime rate" — that says nothing.
    addVideo({ id: 'new', title: 'Just published', ageDays: 10, lifetimeViews: 1000 })
    addDailyStats('new', 10, { views: 100 })

    expect(runCatalogAudit().some((f) => f.kind === 'still_earning')).toBe(false)
  })

  it('marks a thin-traffic finding as low confidence', () => {
    addVideo({ id: 'thin', title: 'Quiet but steady', ageDays: 400, lifetimeViews: 500 })
    addDailyStats('thin', 28, { views: 2 }) // 56 views over 28 days — above the floor, below 100
    addTraffic('thin', { YT_SEARCH: 56 })

    const finding = runCatalogAudit().find((f) => f.kind === 'still_earning')
    expect(finding?.lowConfidence).toBe(true)
  })
})

describe('revival candidates', () => {
  it('separates a thumbnail problem from a content problem', () => {
    // Baseline videos establish the channel's median CTR (~10%).
    for (let i = 0; i < 5; i++) {
      addVideo({ id: `base${i}`, title: `Baseline ${i}`, ageDays: 200, lifetimeViews: 2000 })
      addDailyStats(`base${i}`, 28, { views: 20, impressions: 200, ctr: 0.1, avp: 50 })
    }

    // Shown a lot, clicked rarely → fixable packaging problem.
    addVideo({ id: 'lowctr', title: 'Poor thumbnail', ageDays: 200, lifetimeViews: 2000 })
    addDailyStats('lowctr', 28, { views: 10, impressions: 200, ctr: 0.02, avp: 50 })

    // Clicked a lot, watched barely → not a metadata problem.
    addVideo({ id: 'lowret', title: 'Great title, weak video', ageDays: 200, lifetimeViews: 2000 })
    addDailyStats('lowret', 28, { views: 40, impressions: 100, ctr: 0.2, avp: 12 })

    const findings = runCatalogAudit()

    const thumbnail = findings.find((f) => f.kind === 'revival_thumbnail')
    expect(thumbnail?.videoId).toBe('lowctr')
    expect(thumbnail!.recommendation).toMatch(/fixable/)

    const content = findings.find((f) => f.kind === 'revival_content')
    expect(content?.videoId).toBe('lowret')
    // The honest part: metadata will not save this one, and it says so.
    expect(content!.recommendation).toMatch(/will not help/)
  })

  it('flags ageing evergreen search demand as a remake candidate', () => {
    addVideo({ id: 'remake', title: 'Guide from 2023', ageDays: 500, lifetimeViews: 9000 })
    addDailyStats('remake', 28, { views: 8 })
    addTraffic('remake', { YT_SEARCH: 200, BROWSE: 10 })

    const finding = runCatalogAudit().find((f) => f.kind === 'revival_remake')
    expect(finding?.videoId).toBe('remake')
    expect(finding!.evidence.searchShare).toBeGreaterThan(90)
  })
})

describe('metadata hygiene', () => {
  it('reports each problem and ranks by how much traffic is at stake', () => {
    addVideo({
      id: 'popular-bad',
      title: 'Popular but neglected',
      ageDays: 300,
      lifetimeViews: 50000,
      description: 'short',
      tags: [],
      customThumbnail: false,
    })
    addVideo({
      id: 'obscure-bad',
      title: 'Obscure and neglected',
      ageDays: 300,
      lifetimeViews: 12,
      description: 'short',
      tags: [],
    })

    const hygiene = runCatalogAudit().filter((f) => f.kind === 'metadata_hygiene')

    expect(hygiene[0].videoId).toBe('popular-bad')
    expect(hygiene[0].severity).toBe('important')
    expect(hygiene[0].title).toMatch(/no tags/)
    expect(hygiene[0].title).toMatch(/no custom thumbnail/)
    // Same defects, far less traffic — worth knowing, not worth prioritising.
    expect(hygiene.find((f) => f.videoId === 'obscure-bad')!.severity).toBe('info')
  })

  it('says nothing about a well-formed video', () => {
    addVideo({ id: 'good', title: 'Well kept', ageDays: 300, lifetimeViews: 5000 })
    expect(runCatalogAudit().some((f) => f.kind === 'metadata_hygiene')).toBe(false)
  })
})

describe('honesty about small samples', () => {
  it('refuses to claim a title pattern from a tiny catalogue', () => {
    for (let i = 0; i < 4; i++) {
      addVideo({ id: `v${i}`, title: `Minecraft build ${i}`, ageDays: 100, lifetimeViews: 1000 })
    }

    const pattern = runCatalogAudit().find((f) => f.kind === 'title_pattern')

    expect(pattern!.title).toMatch(/Not enough videos/)
    expect(pattern!.lowConfidence).toBe(true)
    expect(pattern!.detail).toMatch(/would be describing noise/)
  })

  it('labels a pattern drawn from a handful of videos as low confidence', () => {
    // 3 "keyboard" videos at 10k views against 9 others at 500.
    for (let i = 0; i < 3; i++) {
      addVideo({ id: `kb${i}`, title: `Keyboard review ${i}`, ageDays: 100, lifetimeViews: 10000 })
    }
    for (let i = 0; i < 9; i++) {
      addVideo({ id: `misc${i}`, title: `Random vlog ${i}`, ageDays: 100, lifetimeViews: 500 })
    }

    const pattern = runCatalogAudit().find(
      (f) => f.kind === 'title_pattern' && f.evidence.token === 'keyboard'
    )

    expect(pattern).toBeDefined()
    expect(pattern!.evidence.sampleSize).toBe(3)
    expect(pattern!.lowConfidence).toBe(true)
    expect(pattern!.detail).toMatch(/treat as a hint, not a finding/)
    expect(pattern!.recommendation).toMatch(/too small to trust/)
  })

  it('does not flag a well-supported pattern as low confidence', () => {
    for (let i = 0; i < 6; i++) {
      addVideo({ id: `kb${i}`, title: `Keyboard review ${i}`, ageDays: 100, lifetimeViews: 10000 })
    }
    for (let i = 0; i < 9; i++) {
      addVideo({ id: `misc${i}`, title: `Random vlog ${i}`, ageDays: 100, lifetimeViews: 500 })
    }

    const pattern = runCatalogAudit().find(
      (f) => f.kind === 'title_pattern' && f.evidence.token === 'keyboard'
    )
    expect(pattern!.lowConfidence).toBe(false)
  })

  it('says so plainly when no pattern stands out', () => {
    for (let i = 0; i < 10; i++) {
      addVideo({ id: `v${i}`, title: `Unrelated topic ${i}`, ageDays: 100, lifetimeViews: 1000 })
    }
    const pattern = runCatalogAudit().find((f) => f.kind === 'title_pattern')
    expect(pattern!.title).toMatch(/No title pattern outperforms/)
  })
})

describe('cadence', () => {
  it('reports the timeline without asserting causation', () => {
    for (let i = 0; i < 6; i++) {
      addVideo({ id: `c${i}`, title: `Video ${i}`, ageDays: 30 * i + 15, lifetimeViews: 1000 })
      addDailyStats(`c${i}`, 3, { views: 5 })
    }

    const cadence = runCatalogAudit().find((f) => f.kind === 'cadence')
    expect(cadence).toBeDefined()
    expect(Array.isArray(cadence!.evidence.timeline)).toBe(true)
    // The claim is a correlation, and it is labelled as one.
    expect(cadence!.detail).toMatch(/Correlation is not causation|Not enough overlapping/)
  })
})

describe('statistics helpers', () => {
  it('computes a median for odd and even counts', () => {
    expect(median([5, 1, 3])).toBe(3)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBe(0)
  })

  it('computes correlation and refuses when it would be meaningless', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])!).toBeCloseTo(1, 5)
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])!).toBeCloseTo(-1, 5)
    // Too few points to mean anything.
    expect(pearson([1, 2], [2, 4])).toBeNull()
    // A flat series has no correlation to report, and must not divide by zero.
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull()
  })
})
