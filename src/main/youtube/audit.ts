import { randomUUID } from 'crypto'
import { getDatabase } from '../db/database'

/**
 * Back catalog audit.
 *
 * Written as an analysis rather than a table dump: each finding names a specific
 * video, states the numbers behind it, and says what to do. The point is to
 * answer "what should I do with the channel I already have?" for someone
 * returning after time away.
 *
 * Honesty about sample size is a first-class requirement here. A channel with
 * nine videos cannot support confident claims about "what works", and a finding
 * built on three data points is labelled `lowConfidence` rather than dressed up
 * as insight. Presenting noise as a pattern is worse than saying nothing.
 */

/** A video must be at least this old before "is it still earning?" means anything. */
const MATURE_AGE_DAYS = 90

/** Below this, 28-day view counts are too noisy to draw conclusions from. */
const MIN_RECENT_VIEWS = 30

/** Title-pattern findings need at least this many videos before being reported at all. */
const MIN_PATTERN_SAMPLE = 3

/** Below this, a pattern finding is reported but flagged as statistically weak. */
const CONFIDENT_PATTERN_SAMPLE = 5

export type FindingKind =
  | 'still_earning'
  | 'revival_thumbnail'
  | 'revival_content'
  | 'revival_remake'
  | 'ctr_unavailable'
  | 'metadata_hygiene'
  | 'cadence'
  | 'title_pattern'

export type TrafficClass = 'search' | 'suggested' | 'browse_external' | 'mixed' | 'unknown'

export interface AuditFinding {
  id: string
  kind: FindingKind
  videoId: string | null
  severity: 'info' | 'suggestion' | 'important'
  title: string
  detail: string
  evidence: Record<string, unknown>
  recommendation: string
  lowConfidence: boolean
  generatedAt: number
}

interface VideoRow {
  id: string
  title: string
  description: string | null
  published_at: number | null
  duration_s: number | null
  tags_json: string
  has_custom_thumbnail: number
  view_count: number
}

export function runCatalogAudit(): AuditFinding[] {
  const db = getDatabase()
  const now = Date.now()

  const videos = db
    .prepare(
      `SELECT id, title, description, published_at, duration_s, tags_json,
              has_custom_thumbnail, view_count
       FROM yt_videos WHERE privacy_status IS NULL OR privacy_status = 'public'`
    )
    .all() as VideoRow[]

  if (videos.length === 0) return []

  const recent = recentStats(db)
  const traffic = trafficClassification(db)
  const findings: AuditFinding[] = []

  findings.push(...stillEarning(videos, recent, traffic, now))
  findings.push(...revivalCandidates(videos, recent, traffic, now))
  findings.push(...metadataHygiene(videos))
  findings.push(...cadence(db, videos, now))
  findings.push(...titlePatterns(videos, now))

  persist(findings)
  return findings
}

// ── Inputs ──

interface RecentStat {
  views28: number
  impressions28: number
  ctr: number
  avgViewPercentage: number
}

function recentStats(db: ReturnType<typeof getDatabase>): Map<string, RecentStat> {
  const cutoff = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10)
  const rows = db
    .prepare(
      `SELECT video_id,
              SUM(views) AS views28,
              SUM(impressions) AS impressions28,
              /* Impression-weighted, not a mean of daily rates: a day with 4
                 impressions must not count as much as one with 4,000. */
              CASE WHEN SUM(impressions) > 0
                   THEN SUM(ctr * impressions) / SUM(impressions) ELSE 0 END AS ctr,
              CASE WHEN SUM(views) > 0
                   THEN SUM(avg_view_percentage * views) / SUM(views) ELSE 0 END AS avp
       FROM yt_daily_stats WHERE date >= ? GROUP BY video_id`
    )
    .all(cutoff) as Array<{
    video_id: string
    views28: number
    impressions28: number
    ctr: number
    avp: number
  }>

  return new Map(
    rows.map((r) => [
      r.video_id,
      {
        views28: r.views28 ?? 0,
        impressions28: r.impressions28 ?? 0,
        ctr: r.ctr ?? 0,
        avgViewPercentage: r.avp ?? 0,
      },
    ])
  )
}

const SEARCH_SOURCES = new Set(['YT_SEARCH', 'GOOGLE_SEARCH'])
const SUGGESTED_SOURCES = new Set(['RELATED_VIDEO', 'YT_RELATED', 'END_SCREEN', 'ANNOTATION'])

function trafficClassification(
  db: ReturnType<typeof getDatabase>
): Map<string, { klass: TrafficClass; shares: Record<string, number>; total: number }> {
  const rows = db
    .prepare(
      `SELECT t.video_id, t.source_type, t.views
       FROM yt_traffic_sources t
       /* Only the newest window per video — older windows would double-count. */
       JOIN (SELECT video_id, MAX(date) AS d FROM yt_traffic_sources GROUP BY video_id) latest
         ON latest.video_id = t.video_id AND latest.d = t.date`
    )
    .all() as Array<{ video_id: string; source_type: string; views: number }>

  const byVideo = new Map<string, Record<string, number>>()
  for (const row of rows) {
    const bucket = SEARCH_SOURCES.has(row.source_type)
      ? 'search'
      : SUGGESTED_SOURCES.has(row.source_type)
        ? 'suggested'
        : 'browse_external'
    const entry = byVideo.get(row.video_id) ?? {}
    entry[bucket] = (entry[bucket] ?? 0) + row.views
    byVideo.set(row.video_id, entry)
  }

  const out = new Map<string, { klass: TrafficClass; shares: Record<string, number>; total: number }>()
  for (const [videoId, buckets] of byVideo) {
    const total = Object.values(buckets).reduce((a, b) => a + b, 0)
    if (total === 0) {
      out.set(videoId, { klass: 'unknown', shares: {}, total: 0 })
      continue
    }
    const shares = Object.fromEntries(
      Object.entries(buckets).map(([k, v]) => [k, v / total])
    ) as Record<string, number>

    const [topKey, topShare] = Object.entries(shares).sort((a, b) => b[1] - a[1])[0]
    // A dominant source needs a real majority; anything less is genuinely mixed
    // and saying so is more useful than forcing it into a bucket.
    const klass: TrafficClass = topShare >= 0.5 ? (topKey as TrafficClass) : 'mixed'
    out.set(videoId, { klass, shares, total })
  }
  return out
}

// ── Findings ──

function ageDays(publishedAt: number | null, now: number): number {
  if (!publishedAt) return 0
  return Math.max((now - publishedAt) / 86_400_000, 1)
}

function stillEarning(
  videos: VideoRow[],
  recent: Map<string, RecentStat>,
  traffic: ReturnType<typeof trafficClassification>,
  now: number
): AuditFinding[] {
  const findings: AuditFinding[] = []

  for (const video of videos) {
    const age = ageDays(video.published_at, now)
    if (age < MATURE_AGE_DAYS) continue

    const stat = recent.get(video.id)
    if (!stat || stat.views28 < MIN_RECENT_VIEWS) continue

    const lifetimeDaily = video.view_count / age
    const recentDaily = stat.views28 / 28
    if (lifetimeDaily <= 0) continue

    const ratio = recentDaily / lifetimeDaily
    // Still pulling at least 70% of its lifetime daily rate long after launch
    // means durable search or suggested traffic, not the launch spike.
    if (ratio < 0.7) continue

    const klass = traffic.get(video.id)?.klass ?? 'unknown'
    const klassText =
      klass === 'search'
        ? 'search-driven, so it is evergreen and worth reviving'
        : klass === 'suggested'
          ? 'suggested-driven, so it depends on the algorithm continuing to favour it'
          : klass === 'browse_external'
            ? 'browse/external, which usually means a launch spike rather than durable demand'
            : 'from mixed sources'

    findings.push({
      id: randomUUID(),
      kind: 'still_earning',
      videoId: video.id,
      severity: 'important',
      title: `"${video.title}" is still earning`,
      detail:
        `${Math.round(stat.views28)} views in the last 28 days (${recentDaily.toFixed(1)}/day) ` +
        `against a lifetime average of ${lifetimeDaily.toFixed(1)}/day over ${Math.round(age)} days — ` +
        `${(ratio * 100).toFixed(0)}% of its lifetime rate. Traffic is ${klassText}.`,
      evidence: {
        views28: stat.views28,
        recentDailyAverage: Number(recentDaily.toFixed(2)),
        lifetimeDailyAverage: Number(lifetimeDaily.toFixed(2)),
        ratio: Number(ratio.toFixed(2)),
        ageDays: Math.round(age),
        trafficClass: klass,
      },
      recommendation:
        klass === 'search'
          ? 'Refresh the description and pinned comment, and consider a follow-up or remake — the demand is already there.'
          : 'Keep an eye on it; if suggested traffic falls away the views will go with it.',
      lowConfidence: stat.views28 < 100,
      generatedAt: now,
    })
  }

  return findings.sort(
    (a, b) => (b.evidence.views28 as number) - (a.evidence.views28 as number)
  )
}

function revivalCandidates(
  videos: VideoRow[],
  recent: Map<string, RecentStat>,
  traffic: ReturnType<typeof trafficClassification>,
  now: number
): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Compared against the channel's own median rather than an industry number:
  // "below average for you" is actionable, "below 4%" is not.
  const ctrs = [...recent.values()].filter((s) => s.impressions28 >= 500).map((s) => s.ctr)
  const medianCtr = median(ctrs)

  // The two findings below need thumbnail impressions and CTR, and the YouTube
  // Analytics API exposes neither — they exist only in the Reporting API's bulk
  // reach reports, which this app does not ingest (see `syncVideoDailyStats`).
  //
  // Without this, the audit's failure mode is silence: no impressions means the
  // thresholds below can never be met, so a channel with a genuine thumbnail
  // problem reads exactly like a channel with none. Saying "this analysis could
  // not run, and here is why" is the honest version, and it is the difference
  // between an audit that missed something and an audit that lied.
  if (![...recent.values()].some((s) => s.impressions28 > 0)) {
    findings.push({
      id: randomUUID(),
      kind: 'ctr_unavailable',
      videoId: null,
      severity: 'info',
      title: 'Thumbnail CTR analysis could not run',
      detail:
        'No impression data is available for this channel. The YouTube Analytics API does not ' +
        'expose thumbnail impressions or click-through rate — those metrics live only in the ' +
        "Reporting API's bulk reach reports, which REIGAN does not yet ingest.",
      evidence: { videosConsidered: recent.size, metricsSource: 'youtubeAnalytics.reports.query' },
      recommendation:
        'Nothing to fix on your side. Thumbnail and packaging findings stay unavailable until ' +
        'reach-report ingest is built; every other finding in this audit is unaffected.',
      lowConfidence: false,
      generatedAt: now,
    })
  }

  for (const video of videos) {
    const stat = recent.get(video.id)
    if (!stat) continue

    // Thumbnail/title problem: plenty of impressions, few clicks. Fixable.
    if (stat.impressions28 >= 1000 && medianCtr > 0 && stat.ctr < medianCtr * 0.7) {
      findings.push({
        id: randomUUID(),
        kind: 'revival_thumbnail',
        videoId: video.id,
        severity: 'important',
        title: `"${video.title}" is being shown but not clicked`,
        detail:
          `${Math.round(stat.impressions28)} impressions in 28 days at ${(stat.ctr * 100).toFixed(1)}% CTR, ` +
          `against your median of ${(medianCtr * 100).toFixed(1)}%. YouTube is offering it to people ` +
          'and they are scrolling past.',
        evidence: {
          impressions28: stat.impressions28,
          ctr: Number((stat.ctr * 100).toFixed(2)),
          channelMedianCtr: Number((medianCtr * 100).toFixed(2)),
        },
        recommendation:
          'A thumbnail and title problem, which is the fixable kind. Rework both and the existing impressions will do the rest.',
        lowConfidence: ctrs.length < 5,
        generatedAt: now,
      })
    }

    // Content problem: they click, then leave. Metadata will not fix this.
    if (
      stat.impressions28 >= 500 &&
      medianCtr > 0 &&
      stat.ctr > medianCtr * 1.3 &&
      stat.avgViewPercentage > 0 &&
      stat.avgViewPercentage < 30
    ) {
      findings.push({
        id: randomUUID(),
        kind: 'revival_content',
        videoId: video.id,
        severity: 'suggestion',
        title: `"${video.title}" draws clicks but loses people`,
        detail:
          `${(stat.ctr * 100).toFixed(1)}% CTR (well above your ${(medianCtr * 100).toFixed(1)}% median) ` +
          `but only ${stat.avgViewPercentage.toFixed(0)}% average view percentage.`,
        evidence: {
          ctr: Number((stat.ctr * 100).toFixed(2)),
          avgViewPercentage: Number(stat.avgViewPercentage.toFixed(1)),
          channelMedianCtr: Number((medianCtr * 100).toFixed(2)),
        },
        recommendation:
          'The packaging works and the content does not deliver on it. New metadata will not help — this needs a different edit or a remake.',
        lowConfidence: ctrs.length < 5,
        generatedAt: now,
      })
    }

    // Remake candidate: durable search demand for something now out of date.
    const age = ageDays(video.published_at, now)
    const klass = traffic.get(video.id)?.klass
    if (klass === 'search' && age > 365 && stat.views28 >= MIN_RECENT_VIEWS) {
      findings.push({
        id: randomUUID(),
        kind: 'revival_remake',
        videoId: video.id,
        severity: 'suggestion',
        title: `"${video.title}" has ageing evergreen demand`,
        detail:
          `Still taking ${Math.round(stat.views28)} search-driven views in 28 days, ` +
          `${Math.round(age / 365)} year(s) after publishing.`,
        evidence: {
          views28: stat.views28,
          ageDays: Math.round(age),
          searchShare: Number(((traffic.get(video.id)?.shares.search ?? 0) * 100).toFixed(0)),
        },
        recommendation:
          'People are still searching for this. A current remake would inherit the demand — and the old video can point at it.',
        lowConfidence: stat.views28 < 100,
        generatedAt: now,
      })
    }
  }

  return findings
}

function metadataHygiene(videos: VideoRow[]): AuditFinding[] {
  const now = Date.now()
  const findings: AuditFinding[] = []

  for (const video of videos) {
    const problems: string[] = []
    const description = video.description ?? ''
    const tags = safeTags(video.tags_json)

    if (description.trim().length < 100) problems.push('description is thin or missing')
    if (tags.length === 0) problems.push('no tags')
    if (!video.has_custom_thumbnail) problems.push('no custom thumbnail')

    if (problems.length === 0) continue

    findings.push({
      id: randomUUID(),
      kind: 'metadata_hygiene',
      videoId: video.id,
      // A video with real traffic and bad metadata is worth more than a dead one.
      severity: video.view_count > 1000 ? 'important' : 'info',
      title: `"${video.title}" — ${problems.join(', ')}`,
      detail:
        `${problems.join('; ')}. This video has ${video.view_count.toLocaleString()} lifetime views.`,
      evidence: {
        descriptionLength: description.trim().length,
        tagCount: tags.length,
        hasCustomThumbnail: !!video.has_custom_thumbnail,
        lifetimeViews: video.view_count,
      },
      recommendation:
        'Fix the metadata — this is the cheapest work available, and REIGAN can draft it from the video\'s own analytics.',
      lowConfidence: false,
      generatedAt: now,
    })
  }

  return findings.sort(
    (a, b) => (b.evidence.lifetimeViews as number) - (a.evidence.lifetimeViews as number)
  )
}

/**
 * Upload frequency over the channel's life against subscriber growth.
 *
 * Reported as a timeline plus the correlation, without asserting causation: a
 * month with more uploads and more subscribers does not prove the first caused
 * the second, and the honest version of this finding says so.
 */
function cadence(
  db: ReturnType<typeof getDatabase>,
  videos: VideoRow[],
  now: number
): AuditFinding[] {
  const byMonth = new Map<string, { uploads: number; subsGained: number; subsLost: number }>()

  for (const video of videos) {
    if (!video.published_at) continue
    const month = new Date(video.published_at).toISOString().slice(0, 7)
    const entry = byMonth.get(month) ?? { uploads: 0, subsGained: 0, subsLost: 0 }
    entry.uploads += 1
    byMonth.set(month, entry)
  }

  const subRows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, SUM(subs_gained) g, SUM(subs_lost) l
       FROM yt_daily_stats GROUP BY month`
    )
    .all() as Array<{ month: string; g: number; l: number }>

  for (const row of subRows) {
    const entry = byMonth.get(row.month) ?? { uploads: 0, subsGained: 0, subsLost: 0 }
    entry.subsGained = row.g ?? 0
    entry.subsLost = row.l ?? 0
    byMonth.set(row.month, entry)
  }

  const timeline = [...byMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, v]) => ({ month, ...v, netSubs: v.subsGained - v.subsLost }))

  if (timeline.length < 2) return []

  // Only months where both signals exist can support a correlation at all.
  const overlapping = timeline.filter((t) => t.subsGained > 0 || t.subsLost > 0)
  const correlation =
    overlapping.length >= 3
      ? pearson(overlapping.map((t) => t.uploads), overlapping.map((t) => t.netSubs))
      : null

  const activeMonths = timeline.filter((t) => t.uploads > 0)
  const avgUploads =
    activeMonths.length > 0
      ? activeMonths.reduce((a, t) => a + t.uploads, 0) / activeMonths.length
      : 0

  const gapMonths = timeline.length - activeMonths.length

  return [
    {
      id: randomUUID(),
      kind: 'cadence',
      videoId: null,
      severity: 'info',
      title: 'Publishing cadence against subscriber growth',
      detail:
        `${activeMonths.length} month(s) with uploads across ${timeline.length} months of channel history, ` +
        `averaging ${avgUploads.toFixed(1)} uploads in an active month, with ${gapMonths} silent month(s). ` +
        (correlation === null
          ? 'Not enough overlapping subscriber data to say anything about correlation.'
          : `Correlation between uploads and net subscriber change across ${overlapping.length} months is ` +
            `r = ${correlation.toFixed(2)}${Math.abs(correlation) < 0.3 ? ' — effectively none' : ''}. ` +
            'Correlation is not causation, and this is a small number of months.'),
      evidence: { timeline, correlation, avgUploadsPerActiveMonth: Number(avgUploads.toFixed(2)) },
      recommendation:
        gapMonths > activeMonths.length
          ? 'The channel has been silent more often than not. Consistency is the variable most within your control.'
          : 'Cadence has been reasonably steady. Set a target in the Content Pipeline and let the gap check enforce it.',
      lowConfidence: overlapping.length < 6,
      generatedAt: now,
    },
  ]
}

/**
 * Title-token performance.
 *
 * A blunt instrument on purpose. With a few dozen videos, anything more elaborate
 * (embeddings, topic models) produces confident-looking output from data that
 * cannot support it. Tokens with too few videos are dropped entirely, and those
 * near the threshold are flagged.
 */
function titlePatterns(videos: VideoRow[], now: number): AuditFinding[] {
  if (videos.length < MIN_PATTERN_SAMPLE * 2) {
    return [
      {
        id: randomUUID(),
        kind: 'title_pattern',
        videoId: null,
        severity: 'info',
        title: 'Not enough videos to identify title patterns',
        detail:
          `${videos.length} public video(s). Any "what works" claim from a catalogue this size ` +
          'would be describing noise, so none is offered.',
        evidence: { videoCount: videos.length },
        recommendation: 'Revisit once the catalogue is larger.',
        lowConfidence: true,
        generatedAt: now,
      },
    ]
  }

  const stop = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'for', 'with',
    'my', 'i', 'is', 'it', 'this', 'that', 'how', 'what', 'why', 'you', 'your',
  ])

  const byToken = new Map<string, { count: number; views: number[] }>()
  for (const video of videos) {
    const tokens = new Set(
      video.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 2 && !stop.has(t))
    )
    for (const token of tokens) {
      const entry = byToken.get(token) ?? { count: 0, views: [] }
      entry.count += 1
      entry.views.push(video.view_count)
      byToken.set(token, entry)
    }
  }

  const overallMedian = median(videos.map((v) => v.view_count))
  if (overallMedian <= 0) return []

  const candidates = [...byToken.entries()]
    .filter(([, v]) => v.count >= MIN_PATTERN_SAMPLE)
    .map(([token, v]) => ({ token, count: v.count, med: median(v.views) }))
    .filter((c) => c.med > overallMedian * 1.5)
    .sort((a, b) => b.med - a.med)
    .slice(0, 5)

  if (candidates.length === 0) {
    return [
      {
        id: randomUUID(),
        kind: 'title_pattern',
        videoId: null,
        severity: 'info',
        title: 'No title pattern outperforms the rest',
        detail:
          `Across ${videos.length} videos, no recurring title word appears in at least ` +
          `${MIN_PATTERN_SAMPLE} videos and beats the channel median of ` +
          `${Math.round(overallMedian).toLocaleString()} views by a clear margin.`,
        evidence: { videoCount: videos.length, medianViews: Math.round(overallMedian) },
        recommendation: 'Topic, not phrasing, is doing the work here.',
        lowConfidence: false,
        generatedAt: now,
      },
    ]
  }

  return candidates.map((c) => ({
    id: randomUUID(),
    kind: 'title_pattern' as const,
    videoId: null,
    severity: 'info' as const,
    title: `Videos with "${c.token}" in the title do better`,
    detail:
      `${c.count} video(s) contain "${c.token}", with a median of ${Math.round(c.med).toLocaleString()} views ` +
      `against the channel median of ${Math.round(overallMedian).toLocaleString()}. ` +
      (c.count < CONFIDENT_PATTERN_SAMPLE
        ? `Based on only ${c.count} videos — treat as a hint, not a finding.`
        : `Based on ${c.count} videos.`),
    evidence: {
      token: c.token,
      sampleSize: c.count,
      medianViews: Math.round(c.med),
      channelMedianViews: Math.round(overallMedian),
    },
    recommendation:
      c.count < CONFIDENT_PATTERN_SAMPLE
        ? 'Worth testing deliberately rather than acting on directly — the sample is too small to trust.'
        : 'Worth leaning into for the next few videos and watching whether it holds.',
    lowConfidence: c.count < CONFIDENT_PATTERN_SAMPLE,
    generatedAt: now,
  }))
}

// ── Persistence ──

function persist(findings: AuditFinding[]): void {
  const db = getDatabase()
  const insert = db.prepare(
    `INSERT INTO yt_audit_findings
       (id, kind, video_id, severity, title, detail, evidence_json, recommendation,
        low_confidence, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const write = db.transaction(() => {
    // Findings are a snapshot of the current catalogue, so a fresh run replaces
    // the previous one rather than accumulating stale duplicates.
    db.prepare('DELETE FROM yt_audit_findings').run()
    for (const f of findings) {
      insert.run(
        f.id,
        f.kind,
        f.videoId,
        f.severity,
        f.title,
        f.detail,
        JSON.stringify(f.evidence),
        f.recommendation,
        f.lowConfidence ? 1 : 0,
        f.generatedAt
      )
    }
  })
  write()
}

export function listFindings(kind?: FindingKind): AuditFinding[] {
  const db = getDatabase()
  const rows = (
    kind
      ? db.prepare('SELECT * FROM yt_audit_findings WHERE kind = ? ORDER BY generated_at DESC').all(kind)
      : db.prepare('SELECT * FROM yt_audit_findings ORDER BY generated_at DESC').all()
  ) as any[]

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    videoId: r.video_id,
    severity: r.severity,
    title: r.title,
    detail: r.detail,
    evidence: JSON.parse(r.evidence_json),
    recommendation: r.recommendation,
    lowConfidence: !!r.low_confidence,
    generatedAt: r.generated_at,
  }))
}

// ── Statistics ──

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length)
  if (n < 3) return null

  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n

  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const a = xs[i] - meanX
    const b = ys[i] - meanY
    num += a * b
    dx += a * a
    dy += b * b
  }

  // Zero variance in either series — a flat line has no correlation to report.
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

function safeTags(json: string): string[] {
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
