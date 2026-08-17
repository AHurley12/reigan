import { getDatabase } from '../db/database'

/** Cache reads for the UI and the assistant. Never touches the API — see quota.ts. */

export interface ChannelStats {
  id: string
  title: string
  customUrl: string | null
  subscriberCount: number
  viewCount: number
  videoCount: number
  thumbnailUrl: string | null
  syncedAt: number | null
}

export function getChannel(): ChannelStats | null {
  const row = getDatabase().prepare('SELECT * FROM yt_channel LIMIT 1').get() as any
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    customUrl: row.custom_url,
    subscriberCount: row.subscriber_count,
    viewCount: row.view_count,
    videoCount: row.video_count,
    thumbnailUrl: row.thumbnail_url,
    syncedAt: row.synced_at,
  }
}

export interface ChannelSeriesPoint {
  date: string
  views: number
  watchTimeMinutes: number
  netSubs: number
  /** Likes given on that day, not the running lifetime total. */
  likes: number
  /** Comments posted on that day, likewise a daily figure. */
  comments: number
}

/** Daily channel totals for the overview charts. */
export function getChannelSeries(days: number): ChannelSeriesPoint[] {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const rows = getDatabase()
    .prepare(
      `SELECT date,
              SUM(views) AS views,
              SUM(watch_time_minutes) AS watch,
              SUM(subs_gained) - SUM(subs_lost) AS net_subs,
              SUM(likes) AS likes,
              SUM(comments) AS comments
       FROM yt_daily_stats WHERE date >= ? GROUP BY date ORDER BY date`
    )
    .all(cutoff) as Array<{
    date: string
    views: number
    watch: number
    net_subs: number
    likes: number
    comments: number
  }>

  return rows.map((r) => ({
    date: r.date,
    views: r.views ?? 0,
    watchTimeMinutes: r.watch ?? 0,
    netSubs: r.net_subs ?? 0,
    likes: r.likes ?? 0,
    comments: r.comments ?? 0,
  }))
}

export type PerformanceTier = 'top' | 'solid' | 'underperforming' | 'dormant'

export interface VideoSummary {
  id: string
  title: string
  publishedAt: number | null
  durationS: number | null
  privacyStatus: string | null
  thumbnailUrl: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  tags: string[]
  descriptionLength: number
  hasCustomThumbnail: boolean
  views28: number
  tier: PerformanceTier
}

export interface ListVideosFilters {
  publishedAfter?: number
  publishedBefore?: number
  tier?: PerformanceTier
  /** Metadata-hygiene filters, matching the audit's definitions. */
  missingDescription?: boolean
  missingTags?: boolean
  missingCustomThumbnail?: boolean
  search?: string
  sortBy?: 'views' | 'published' | 'recentViews' | 'likes' | 'comments'
  limit?: number
}

export function listVideos(filters: ListVideosFilters = {}): VideoSummary[] {
  const db = getDatabase()
  const cutoff = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)

  const rows = db
    .prepare(
      `SELECT v.*, COALESCE(r.views28, 0) AS views28
       FROM yt_videos v
       LEFT JOIN (SELECT video_id, SUM(views) AS views28 FROM yt_daily_stats
                  WHERE date >= ? GROUP BY video_id) r ON r.video_id = v.id`
    )
    .all(cutoff) as any[]

  // Tiers are relative to this channel's own median, not an absolute number —
  // "top" has to mean top *for you*.
  const views = rows.map((r) => r.view_count as number).sort((a, b) => a - b)
  const med = views.length ? views[Math.floor(views.length / 2)] : 0

  let out: VideoSummary[] = rows.map((r) => {
    const tier: PerformanceTier =
      med > 0 && r.view_count >= med * 2
        ? 'top'
        : r.views28 === 0 && r.view_count < med
          ? 'dormant'
          : r.view_count >= med
            ? 'solid'
            : 'underperforming'

    return {
      id: r.id,
      title: r.title,
      publishedAt: r.published_at,
      durationS: r.duration_s,
      privacyStatus: r.privacy_status,
      thumbnailUrl: r.thumbnail_url,
      viewCount: r.view_count,
      likeCount: r.like_count,
      commentCount: r.comment_count,
      tags: safeTags(r.tags_json),
      descriptionLength: (r.description ?? '').trim().length,
      hasCustomThumbnail: !!r.has_custom_thumbnail,
      views28: r.views28,
      tier,
    }
  })

  if (filters.publishedAfter) out = out.filter((v) => (v.publishedAt ?? 0) >= filters.publishedAfter!)
  if (filters.publishedBefore) out = out.filter((v) => (v.publishedAt ?? 0) <= filters.publishedBefore!)
  if (filters.tier) out = out.filter((v) => v.tier === filters.tier)
  if (filters.missingDescription) out = out.filter((v) => v.descriptionLength < 100)
  if (filters.missingTags) out = out.filter((v) => v.tags.length === 0)
  if (filters.missingCustomThumbnail) out = out.filter((v) => !v.hasCustomThumbnail)
  if (filters.search) {
    const q = filters.search.toLowerCase()
    out = out.filter((v) => v.title.toLowerCase().includes(q))
  }

  const sorters: Record<string, (a: VideoSummary, b: VideoSummary) => number> = {
    views: (a, b) => b.viewCount - a.viewCount,
    published: (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
    recentViews: (a, b) => b.views28 - a.views28,
    likes: (a, b) => b.likeCount - a.likeCount,
    comments: (a, b) => b.commentCount - a.commentCount,
  }
  out.sort(sorters[filters.sortBy ?? 'published'])

  return filters.limit ? out.slice(0, filters.limit) : out
}

export function getVideo(id: string): VideoSummary | null {
  return listVideos().find((v) => v.id === id) ?? null
}

/**
 * Drops a video and its analytics history from the local cache.
 *
 * `yt_daily_stats` and `yt_traffic_sources` key off `video_id` but declare no
 * foreign key to `yt_videos`, so nothing cascades — deleting only the parent
 * row would leave stats behind that no longer belong to any video the app can
 * name. Wrapped in a transaction so a failure part-way cannot produce exactly
 * the orphan state this exists to avoid.
 *
 * Local only. Callers that also intend to delete the video on YouTube must do
 * that first: a cache row is recoverable by re-syncing, a YouTube video is not.
 */
export function deleteVideoFromCache(id: string): void {
  const db = getDatabase()
  db.transaction(() => {
    db.prepare('DELETE FROM yt_traffic_sources WHERE video_id = ?').run(id)
    db.prepare('DELETE FROM yt_daily_stats WHERE video_id = ?').run(id)
    db.prepare('DELETE FROM yt_videos WHERE id = ?').run(id)
  })()
}

export interface VideoAnalytics {
  videoId: string
  title: string
  daily: Array<{
    date: string
    views: number
    watchTimeMinutes: number
    avgViewPercentage: number
    impressions: number
    ctr: number
  }>
  trafficSources: Array<{ sourceType: string; views: number; share: number }>
  totals: {
    views: number
    watchTimeMinutes: number
    avgViewPercentage: number
    impressions: number
    ctr: number
  }
}

export function getVideoAnalytics(videoId: string, days = 90): VideoAnalytics | null {
  const db = getDatabase()
  const video = db.prepare('SELECT id, title FROM yt_videos WHERE id = ?').get(videoId) as
    | { id: string; title: string }
    | undefined
  if (!video) return null

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const daily = db
    .prepare(
      `SELECT date, views, watch_time_minutes, avg_view_percentage, impressions, ctr
       FROM yt_daily_stats WHERE video_id = ? AND date >= ? ORDER BY date`
    )
    .all(videoId, cutoff) as any[]

  const traffic = db
    .prepare(
      `SELECT source_type, views FROM yt_traffic_sources
       WHERE video_id = ? AND date = (SELECT MAX(date) FROM yt_traffic_sources WHERE video_id = ?)`
    )
    .all(videoId, videoId) as Array<{ source_type: string; views: number }>

  const trafficTotal = traffic.reduce((a, t) => a + t.views, 0)
  const views = daily.reduce((a, d) => a + d.views, 0)
  const impressions = daily.reduce((a, d) => a + d.impressions, 0)

  return {
    videoId,
    title: video.title,
    daily: daily.map((d) => ({
      date: d.date,
      views: d.views,
      watchTimeMinutes: d.watch_time_minutes,
      avgViewPercentage: d.avg_view_percentage,
      impressions: d.impressions,
      ctr: d.ctr,
    })),
    trafficSources: traffic
      .map((t) => ({
        sourceType: t.source_type,
        views: t.views,
        share: trafficTotal > 0 ? t.views / trafficTotal : 0,
      }))
      .sort((a, b) => b.views - a.views),
    totals: {
      views,
      watchTimeMinutes: daily.reduce((a, d) => a + d.watch_time_minutes, 0),
      // Weighted by views, so low-traffic days do not distort the average.
      avgViewPercentage:
        views > 0 ? daily.reduce((a, d) => a + d.avg_view_percentage * d.views, 0) / views : 0,
      impressions,
      ctr: impressions > 0 ? daily.reduce((a, d) => a + d.ctr * d.impressions, 0) / impressions : 0,
    },
  }
}

function safeTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
