import type BetterSqlite3 from 'better-sqlite3'
import { getDatabase } from '../db/database'
import { CapabilityError, type CapabilityContext } from '../capabilities/types'
import { analyticsCall, getYouTubeClients, isoDate, meteredCall, parseDuration } from './api'
import { assertBudget, getQuotaStatus } from './quota'
import { recordAppError } from '../errors/errorLog'

/**
 * Channel sync.
 *
 * The quota discipline here is the whole point:
 *
 *   - Videos are enumerated through the **uploads playlist**
 *     (`playlistItems.list`, 1 unit per page of 50), never `search.list`,
 *     which costs 100 units per call. On a 200-video channel that is 4 units
 *     instead of 400+.
 *   - `videos.list` is batched 50 ids at a time, 1 unit per batch.
 *   - Everything lands in SQLite. The UI reads the cache, never the API.
 *
 * A first full sync of a 200-video channel costs roughly 10 Data API units.
 * Analytics runs on its own separate quota.
 */

/** Days of history fetched on a channel's first sync. */
const INITIAL_HISTORY_DAYS = 365

/** Re-fetched every sync, because YouTube revises recent figures for days afterwards. */
const INCREMENTAL_OVERLAP_DAYS = 3

export interface SyncResult {
  channelTitle: string
  videosSynced: number
  statsRowsWritten: number
  trafficRowsWritten: number
  quotaUnitsUsed: number
  incremental: boolean
  durationMs: number
}

export async function syncChannel(
  args: { full?: boolean },
  ctx: CapabilityContext
): Promise<SyncResult> {
  const startedAt = Date.now()
  const quotaBefore = getQuotaStatus().used
  const { data, analytics } = getYouTubeClients()
  const db = getDatabase()

  const existing = db.prepare('SELECT id, synced_at FROM yt_channel LIMIT 1').get() as
    | { id: string; synced_at: number | null }
    | undefined
  const incremental = !args.full && !!existing?.synced_at

  // Estimated generously and checked up front — refusing a sync that would just
  // have fitted is far better than starting one that dies half-populated.
  const estimatedVideoCount = (db.prepare('SELECT COUNT(*) c FROM yt_videos').get() as { c: number }).c
  const estimate = 1 + Math.ceil(Math.max(estimatedVideoCount, 50) / 50) * 2 + 10
  assertBudget(estimate)

  const throwIfCancelled = () => {
    if (ctx.signal?.aborted) throw new CapabilityError('Sync cancelled.', 'cancelled')
  }

  // ── 1. Channel (1 unit) ──
  ctx.onProgress?.({ done: 0, total: 4, label: 'Reading channel…' })

  const channelRes = await meteredCall('channels.list', () =>
    data.channels.list({ part: ['snippet', 'statistics', 'contentDetails'], mine: true })
  )
  const channel = channelRes.data.items?.[0]
  if (!channel?.id) {
    throw new CapabilityError(
      'No YouTube channel found on this Google account.',
      'not_found'
    )
  }

  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads
  if (!uploadsPlaylistId) {
    throw new CapabilityError('Channel has no uploads playlist.', 'handler_failed')
  }

  db.prepare(
    `INSERT INTO yt_channel
       (id, title, custom_url, subscriber_count, view_count, video_count,
        thumbnail_url, uploads_playlist_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, custom_url = excluded.custom_url,
       subscriber_count = excluded.subscriber_count, view_count = excluded.view_count,
       video_count = excluded.video_count, thumbnail_url = excluded.thumbnail_url,
       uploads_playlist_id = excluded.uploads_playlist_id, synced_at = excluded.synced_at`
  ).run(
    channel.id,
    channel.snippet?.title ?? '',
    channel.snippet?.customUrl ?? null,
    Number(channel.statistics?.subscriberCount ?? 0),
    Number(channel.statistics?.viewCount ?? 0),
    Number(channel.statistics?.videoCount ?? 0),
    channel.snippet?.thumbnails?.high?.url ?? null,
    uploadsPlaylistId,
    Date.now()
  )

  // ── 2. Video ids via the uploads playlist (1 unit per 50) ──
  ctx.onProgress?.({ done: 1, total: 4, label: 'Listing videos…' })

  const videoIds: string[] = []
  let pageToken: string | undefined
  do {
    throwIfCancelled()
    const page = await meteredCall('playlistItems.list', () =>
      data.playlistItems.list({
        part: ['contentDetails'],
        playlistId: uploadsPlaylistId,
        maxResults: 50,
        pageToken,
      })
    )
    for (const item of page.data.items ?? []) {
      const id = item.contentDetails?.videoId
      if (id) videoIds.push(id)
    }
    pageToken = page.data.nextPageToken ?? undefined
  } while (pageToken)

  // ── 3. Video details, batched 50 at a time (1 unit per batch) ──
  ctx.onProgress?.({ done: 2, total: 4, label: `Reading ${videoIds.length} videos…` })

  const upsertVideo = db.prepare(
    `INSERT INTO yt_videos
       (id, title, description, published_at, duration_s, privacy_status, thumbnail_url,
        has_custom_thumbnail, tags_json, category_id, view_count, like_count, comment_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title, description = excluded.description,
       published_at = excluded.published_at, duration_s = excluded.duration_s,
       privacy_status = excluded.privacy_status, thumbnail_url = excluded.thumbnail_url,
       has_custom_thumbnail = excluded.has_custom_thumbnail,
       tags_json = excluded.tags_json, category_id = excluded.category_id,
       view_count = excluded.view_count, like_count = excluded.like_count,
       comment_count = excluded.comment_count, synced_at = excluded.synced_at`
  )

  let videosSynced = 0
  for (const batch of chunk(videoIds, 50)) {
    throwIfCancelled()
    const res = await meteredCall('videos.list', () =>
      data.videos.list({ part: ['snippet', 'contentDetails', 'statistics', 'status'], id: batch })
    )

    const write = db.transaction((items: typeof res.data.items) => {
      for (const v of items ?? []) {
        if (!v.id) continue
        const thumbs = v.snippet?.thumbnails
        upsertVideo.run(
          v.id,
          v.snippet?.title ?? '',
          v.snippet?.description ?? '',
          v.snippet?.publishedAt ? Date.parse(v.snippet.publishedAt) : null,
          parseDuration(v.contentDetails?.duration),
          v.status?.privacyStatus ?? null,
          thumbs?.maxres?.url ?? thumbs?.high?.url ?? thumbs?.default?.url ?? null,
          // `maxres` only exists for uploaded custom thumbnails; auto-generated
          // frames stop at `standard`. An imperfect but reliable proxy.
          thumbs?.maxres ? 1 : 0,
          JSON.stringify(v.snippet?.tags ?? []),
          v.snippet?.categoryId ?? null,
          Number(v.statistics?.viewCount ?? 0),
          Number(v.statistics?.likeCount ?? 0),
          Number(v.statistics?.commentCount ?? 0),
          Date.now()
        )
        videosSynced += 1
      }
    })
    write(res.data.items)
  }

  // ── 4. Analytics (separate quota) ──
  ctx.onProgress?.({ done: 3, total: 4, label: 'Fetching analytics…' })

  const endDate = new Date()
  const startDate = new Date(endDate)
  startDate.setDate(startDate.getDate() - (incremental ? INCREMENTAL_OVERLAP_DAYS : INITIAL_HISTORY_DAYS))

  let statsRowsWritten = 0
  let trafficRowsWritten = 0

  const upsertStat = db.prepare(
    `INSERT INTO yt_daily_stats
       (video_id, date, views, watch_time_minutes, avg_view_duration_s, avg_view_percentage,
        subs_gained, subs_lost, impressions, ctr, likes, comments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(video_id, date) DO UPDATE SET
       views = excluded.views, watch_time_minutes = excluded.watch_time_minutes,
       avg_view_duration_s = excluded.avg_view_duration_s,
       avg_view_percentage = excluded.avg_view_percentage,
       subs_gained = excluded.subs_gained, subs_lost = excluded.subs_lost,
       impressions = excluded.impressions, ctr = excluded.ctr,
       likes = excluded.likes, comments = excluded.comments`
  )

  const upsertTraffic = db.prepare(
    `INSERT INTO yt_traffic_sources (video_id, date, source_type, views)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(video_id, date, source_type) DO UPDATE SET views = excluded.views`
  )

  for (const [i, videoId] of videoIds.entries()) {
    throwIfCancelled()
    ctx.onProgress?.({
      done: i,
      total: videoIds.length,
      label: `Analytics ${i + 1}/${videoIds.length}`,
    })

    statsRowsWritten += await syncVideoDailyStats(
      analytics,
      upsertStat,
      db,
      videoId,
      isoDate(startDate),
      isoDate(endDate)
    )
    trafficRowsWritten += await syncVideoTraffic(
      analytics,
      upsertTraffic,
      db,
      videoId,
      isoDate(startDate),
      isoDate(endDate)
    )
  }

  return {
    channelTitle: channel.snippet?.title ?? '',
    videosSynced,
    statsRowsWritten,
    trafficRowsWritten,
    quotaUnitsUsed: getQuotaStatus().used - quotaBefore,
    incremental,
    durationMs: Date.now() - startedAt,
  }
}

async function syncVideoDailyStats(
  analytics: ReturnType<typeof getYouTubeClients>['analytics'],
  upsert: BetterSqlite3.Statement,
  db: BetterSqlite3.Database,
  videoId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const res = await analyticsCall(`daily stats for ${videoId}`, () =>
    analytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'day',
      // `likes` and `comments` are appended rather than inserted: the response's
      // column order mirrors this string, and the row is destructured
      // positionally below. Adding to the end leaves every existing index alone.
      // They belong to the same core metric group as the rest, so this stays one
      // request — engagement costs no extra Analytics call.
      metrics:
        'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,' +
        'subscribersGained,subscribersLost,likes,comments',
      filters: `video==${videoId}`,
    })
  )

  const rows = res.data.rows ?? []
  if (rows.length === 0) return 0

  // Impressions and CTR live in a different metric group and are not always
  // available (they need the channel to be eligible); requested separately so a
  // failure there does not lose the core stats.
  const impressions = await fetchImpressions(analytics, videoId, startDate, endDate)

  const write = db.transaction(() => {
    for (const row of rows) {
      const [date, views, minutes, avgDuration, avgPercentage, gained, lost, likes, comments] =
        row as [string, number, number, number, number, number, number, number, number]
      const imp = impressions.get(date)
      upsert.run(
        videoId,
        date,
        views ?? 0,
        minutes ?? 0,
        avgDuration ?? 0,
        avgPercentage ?? 0,
        gained ?? 0,
        lost ?? 0,
        imp?.impressions ?? 0,
        imp?.ctr ?? 0,
        likes ?? 0,
        comments ?? 0
      )
    }
  })
  write()

  return rows.length
}

async function fetchImpressions(
  analytics: ReturnType<typeof getYouTubeClients>['analytics'],
  videoId: string,
  startDate: string,
  endDate: string
): Promise<Map<string, { impressions: number; ctr: number }>> {
  const map = new Map<string, { impressions: number; ctr: number }>()
  try {
    // Routed through analyticsCall like its two siblings above and below. Going
    // direct meant this was the one analytics call in the file where an expired
    // or revoked grant never reached handleInvalidGrant, so the account was
    // never marked disconnected and the user was never prompted to reconnect.
    const res = await analyticsCall(`impressions for ${videoId}`, () =>
      analytics.reports.query({
        ids: 'channel==MINE',
        startDate,
        endDate,
        dimensions: 'day',
        metrics: 'impressions,impressionClickThroughRate',
        filters: `video==${videoId}`,
      })
    )
    for (const row of res.data.rows ?? []) {
      const [date, impressions, ctr] = row as [string, number, number]
      map.set(date, { impressions: impressions ?? 0, ctr: ctr ?? 0 })
    }
  } catch (err) {
    // A dead grant is not a missing metric, and the difference decides whether
    // the sync may keep going. Swallowing it would report success for a channel
    // the app can no longer read, write zeroed impressions over good rows, and
    // repeat the failed round trip once per remaining video. Let it out.
    if (err instanceof CapabilityError && err.code === 'not_connected') throw err

    // Impression metrics are not available for every channel or date range.
    // Their absence weakens one audit finding; it must not fail the sync.
    //
    // Recorded rather than merely swallowed: this is the exact shape of failure
    // the log exists for. The sync returns success, the audit quietly runs on
    // less data, and without a row here the only symptom is a finding that
    // seems wrong for reasons nobody can reconstruct.
    recordAppError({
      source: 'youtube',
      operation: 'impressionMetrics',
      error: err,
      subject: videoId,
      severity: 'warning',
      context: {
        startDate,
        endDate,
        consequence: 'CTR/impression audit finding computed without data',
      },
    })
  }
  return map
}

/**
 * Traffic sources, aggregated over the sync window rather than per day.
 *
 * Per-day × per-source × per-video would be an enormous number of rows to
 * support an analysis that only ever asks "what proportion of this video's
 * traffic is search?". The window's end date is stored as the row's date.
 */
async function syncVideoTraffic(
  analytics: ReturnType<typeof getYouTubeClients>['analytics'],
  upsert: BetterSqlite3.Statement,
  db: BetterSqlite3.Database,
  videoId: string,
  startDate: string,
  endDate: string
): Promise<number> {
  const res = await analyticsCall(`traffic sources for ${videoId}`, () =>
    analytics.reports.query({
      ids: 'channel==MINE',
      startDate,
      endDate,
      dimensions: 'insightTrafficSourceType',
      metrics: 'views',
      filters: `video==${videoId}`,
    })
  )

  const rows = res.data.rows ?? []
  const write = db.transaction(() => {
    for (const row of rows) {
      const [sourceType, views] = row as [string, number]
      upsert.run(videoId, endDate, sourceType, views ?? 0)
    }
  })
  write()

  return rows.length
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
