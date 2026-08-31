import { z } from 'zod'
import { CapabilityError, type AnyCapability, type CapabilityContext } from '../types'
import { getYouTubeClients, meteredCall } from '../../youtube/api'
import { syncChannel } from '../../youtube/sync'
import { ingestReachReports } from '../../youtube/reporting'
import { listFindings, runCatalogAudit, type AuditFinding } from '../../youtube/audit'
import { getQuotaStatus } from '../../youtube/quota'
import {
  deleteVideoFromCache,
  getChannel,
  getChannelSeries,
  getVideo,
  getVideoAnalytics,
  listVideos,
} from '../../youtube/queries'

const tierEnum = z.enum(['top', 'solid', 'underperforming', 'dormant'])

const listVideosSchema = z.object({
  tier: tierEnum.optional().describe('Filter by performance tier relative to this channel'),
  publishedAfter: z.number().optional().describe('Unix ms — only videos published after this'),
  publishedBefore: z.number().optional().describe('Unix ms — only videos published before this'),
  missingDescription: z.boolean().optional().describe('Only videos with a thin or missing description'),
  missingTags: z.boolean().optional().describe('Only videos with no tags'),
  missingCustomThumbnail: z.boolean().optional().describe('Only videos using an auto-generated thumbnail'),
  search: z.string().optional().describe('Substring match on the title'),
  sortBy: z.enum(['views', 'published', 'recentViews', 'likes', 'comments']).optional(),
  limit: z.number().int().min(1).max(200).optional(),
})

const deleteVideoSchema = z.object({
  videoId: z
    .string()
    .describe(
      'The YouTube video id. Resolve a title to an id with youtube.listVideos first and pass the id — ' +
        'never guess one from a title, because the deletion cannot be undone if the match is wrong.'
    ),
})

const updateMetadataSchema = z.object({
  videoId: z.string().describe('The YouTube video id'),
  title: z.string().max(100).optional().describe('New title (max 100 characters)'),
  description: z.string().max(5000).optional().describe('New description'),
  tags: z.array(z.string()).max(60).optional().describe('Replacement tag list'),
})

export const youtubeCapabilities: AnyCapability[] = [
  {
    id: 'youtube.sync',
    title: 'Sync YouTube channel',
    description:
      'Fetch the latest channel, video, and analytics data from YouTube into the local cache. ' +
      'Incremental by default. Costs YouTube Data API quota, so it is scheduled daily rather than run on demand.',
    risk: 'network',
    requiresGoogle: true,
    schema: z.object({
      full: z
        .boolean()
        .optional()
        .describe('Re-fetch 365 days of history rather than only recent days'),
    }),
    handler: (args: { full?: boolean }, ctx: CapabilityContext) => syncChannel(args, ctx),
    formatResult: (r: Awaited<ReturnType<typeof syncChannel>>) =>
      `Synced ${r.channelTitle}: ${r.videosSynced} videos, ${r.statsRowsWritten} daily stat rows, ` +
      `${r.quotaUnitsUsed} quota units used, in ${(r.durationMs / 1000).toFixed(1)}s ` +
      `(${r.incremental ? 'incremental' : 'full'})` +
      // Stated rather than swallowed: a sync that skipped 30 videos is a
      // different event from a clean one, and the numbers above look identical.
      `${r.analyticsFailures > 0 ? `. Analytics unavailable for ${r.analyticsFailures} video(s), which kept their previous figures` : ''}.`,
  },

  {
    id: 'youtube.ingestReach',
    title: 'Ingest YouTube reach reports',
    description:
      'Download thumbnail impression and click-through-rate data from the YouTube Reporting API ' +
      'into the local cache. These metrics are unavailable to the Analytics API the channel sync ' +
      'uses, and they are what the thumbnail and packaging audit findings run on. ' +
      'Costs no Data API quota.',
    risk: 'network',
    requiresGoogle: true,
    schema: z.object({}),
    handler: () => ingestReachReports(),
    formatResult: (r: Awaited<ReturnType<typeof ingestReachReports>>) =>
      r.jobCreated
        ? 'Reach collection started. Google generates the first report within 48 hours, and ' +
          '30 days of history will backfill with it.'
        : r.reportsIngested === 0
          ? 'No new reach reports yet.'
          : `Ingested ${r.reportsIngested} report(s): ${r.rowsWritten} daily rows` +
            `${r.rowsSkipped > 0 ? `, ${r.rowsSkipped} skipped for videos not in the catalog` : ''}` +
            `, in ${(r.durationMs / 1000).toFixed(1)}s.`,
  },

  {
    id: 'youtube.getChannelStats',
    title: 'Channel statistics',
    description:
      'Subscriber count, total views, video count, and a daily series for the requested window. Reads the local cache.',
    risk: 'read',
    schema: z.object({
      days: z.number().int().min(1).max(3650).optional().describe('Series window in days (default 28)'),
    }),
    handler: ({ days }: { days?: number }) => {
      const channel = getChannel()
      if (!channel) {
        throw new CapabilityError(
          'No channel data yet. Run youtube.sync first.',
          'not_found'
        )
      }
      return { channel, series: getChannelSeries(days ?? 28) }
    },
    formatResult: (r: { channel: NonNullable<ReturnType<typeof getChannel>>; series: unknown[] }) =>
      `${r.channel.title}: ${r.channel.subscriberCount.toLocaleString()} subscribers, ` +
      `${r.channel.viewCount.toLocaleString()} total views across ${r.channel.videoCount} videos. ` +
      `Last synced ${r.channel.syncedAt ? new Date(r.channel.syncedAt).toLocaleString() : 'never'}.`,
  },

  {
    id: 'youtube.listVideos',
    title: 'List videos',
    description:
      'List the channel\'s videos from the local cache, with filters for performance tier, publish date, ' +
      'metadata problems, and title text. Use to answer questions about the back catalogue.',
    risk: 'read',
    schema: listVideosSchema,
    handler: (args: z.infer<typeof listVideosSchema>) => listVideos(args),
    formatResult: (videos: ReturnType<typeof listVideos>) => {
      if (videos.length === 0) return 'No videos matched.'
      return videos
        .slice(0, 40)
        .map(
          (v) =>
            `• "${v.title}" — ${v.viewCount.toLocaleString()} views (${v.views28} in 28d), ` +
            `${v.tier}${v.publishedAt ? `, published ${new Date(v.publishedAt).toLocaleDateString()}` : ''} [${v.id}]`
        )
        .join('\n')
    },
  },

  {
    id: 'youtube.getVideoAnalytics',
    title: 'Video analytics',
    description:
      'Daily views, watch time, retention, impressions, CTR, and traffic-source breakdown for one video.',
    risk: 'read',
    schema: z.object({
      videoId: z.string(),
      days: z.number().int().min(1).max(3650).optional().describe('Window in days (default 90)'),
    }),
    handler: ({ videoId, days }: { videoId: string; days?: number }) => {
      const analytics = getVideoAnalytics(videoId, days ?? 90)
      if (!analytics) throw new CapabilityError(`No cached video with id ${videoId}.`, 'not_found')
      return analytics
    },
    formatResult: (a: NonNullable<ReturnType<typeof getVideoAnalytics>>) => {
      const sources = a.trafficSources
        .slice(0, 4)
        .map((s) => `${s.sourceType} ${(s.share * 100).toFixed(0)}%`)
        .join(', ')
      return (
        `"${a.title}": ${a.totals.views.toLocaleString()} views, ` +
        `${Math.round(a.totals.watchTimeMinutes).toLocaleString()} watch-time minutes, ` +
        `${a.totals.avgViewPercentage.toFixed(0)}% average view percentage` +
        (a.totals.impressions > 0
          ? `, ${a.totals.impressions.toLocaleString()} impressions at ${(a.totals.ctr * 100).toFixed(1)}% CTR`
          : '') +
        (sources ? `. Traffic: ${sources}.` : '.')
      )
    },
  },

  {
    id: 'youtube.auditCatalog',
    title: 'Audit back catalogue',
    description:
      'Analyse the back catalogue for videos still earning views, revival candidates, metadata problems, ' +
      'publishing cadence, and title patterns. Each finding carries the numbers behind it. ' +
      'Findings based on small samples are explicitly marked as low confidence — say so when reporting them.',
    risk: 'read',
    schema: z.object({
      refresh: z.boolean().optional().describe('Recompute rather than returning the stored findings'),
    }),
    // `refresh: false` reads the stored findings — what the UI does on mount, so
    // opening the tab does not recompute the whole catalogue. Any other call
    // recomputes, which is what the assistant should get when asked a question.
    handler: ({ refresh }: { refresh?: boolean }) =>
      refresh === false ? listFindings() : runCatalogAudit(),
    formatResult: (findings: AuditFinding[]) => {
      if (findings.length === 0) return 'No findings — sync the channel first if this is unexpected.'
      const byKind = new Map<string, AuditFinding[]>()
      for (const f of findings) {
        byKind.set(f.kind, [...(byKind.get(f.kind) ?? []), f])
      }
      return [...byKind.entries()]
        .map(([kind, group]) => {
          const lines = group
            .slice(0, 6)
            .map(
              (f) =>
                `  • ${f.title}${f.lowConfidence ? ' [low confidence]' : ''}\n    ${f.detail}\n    → ${f.recommendation}`
            )
            .join('\n')
          return `${kind} (${group.length}):\n${lines}`
        })
        .join('\n\n')
    },
  },

  {
    id: 'youtube.getQuota',
    title: 'YouTube API quota',
    description:
      'Today\'s YouTube Data API quota consumption against the configured budget. Use before suggesting a sync.',
    risk: 'read',
    schema: z.object({}),
    handler: () => getQuotaStatus(),
    formatResult: (q: ReturnType<typeof getQuotaStatus>) =>
      `${q.used} of ${q.budget} budgeted units used today (${q.date}, Pacific). ` +
      `${q.remaining} remaining. Google's hard limit is ${q.limit}.`,
  },

  {
    id: 'youtube.suggestMetadata',
    title: 'Gather metadata context',
    description:
      'Assemble everything needed to write better metadata for a video: its current title, description and tags, ' +
      'its analytics, its traffic sources, and the titles of the channel\'s best-performing videos. ' +
      'Returns context only — YOU write the suggested title, description and tags from it, then call ' +
      'youtube.updateVideoMetadata to apply them.',
    risk: 'read',
    schema: z.object({ videoId: z.string() }),
    handler: ({ videoId }: { videoId: string }) => {
      const video = getVideo(videoId)
      if (!video) throw new CapabilityError(`No cached video with id ${videoId}.`, 'not_found')

      const analytics = getVideoAnalytics(videoId, 90)
      const topPerformers = listVideos({ sortBy: 'views', limit: 10 }).map((v) => ({
        title: v.title,
        views: v.viewCount,
      }))

      // Deliberately context, not a draft. Templated metadata reads like
      // templated metadata; the model writes the actual words.
      return {
        video: {
          id: video.id,
          title: video.title,
          tags: video.tags,
          descriptionLength: video.descriptionLength,
          publishedAt: video.publishedAt,
          durationS: video.durationS,
          viewCount: video.viewCount,
          tier: video.tier,
        },
        analytics: analytics?.totals ?? null,
        trafficSources: analytics?.trafficSources.slice(0, 5) ?? [],
        topPerformingTitles: topPerformers,
        findings: listFindings().filter((f) => f.videoId === videoId),
      }
    },
  },

  {
    id: 'youtube.updateVideoMetadata',
    title: 'Update video metadata',
    description:
      'Apply a new title, description, and/or tags to a YouTube video. Shows the user a before/after diff ' +
      'and requires their approval. Costs 50 quota units.',
    risk: 'write',
    requiresGoogle: true,
    schema: updateMetadataSchema,
    approval: {
      summary: (args: z.infer<typeof updateMetadataSchema>) => {
        const video = getVideo(args.videoId)
        const fields = ['title', 'description', 'tags'].filter(
          (f) => args[f as keyof typeof args] !== undefined
        )
        return `Update ${fields.join(', ')} on "${video?.title ?? args.videoId}" — this changes the live video on YouTube`
      },
      diff: (args: z.infer<typeof updateMetadataSchema>) => {
        const video = getVideo(args.videoId)
        if (!video) return null

        const changes: Array<{ field: string; before: string | null; after: string | null }> = []
        if (args.title !== undefined) {
          changes.push({ field: 'title', before: video.title, after: args.title })
        }
        if (args.description !== undefined) {
          changes.push({
            field: 'description',
            before: `${video.descriptionLength} characters`,
            after: `${args.description.length} characters`,
          })
        }
        if (args.tags !== undefined) {
          changes.push({
            field: 'tags',
            before: video.tags.join(', ') || '(none)',
            after: args.tags.join(', ') || '(none)',
          })
        }
        return { subject: video.title, changes }
      },
    },
    handler: async (args: z.infer<typeof updateMetadataSchema>) => {
      const { data } = getYouTubeClients()

      // videos.update replaces the whole snippet, so anything not re-sent is
      // wiped. Read the current snippet first and merge — this is the difference
      // between changing a title and silently deleting the description.
      const current = await meteredCall('videos.list', () =>
        data.videos.list({ part: ['snippet'], id: [args.videoId] })
      )
      const snippet = current.data.items?.[0]?.snippet
      if (!snippet) {
        throw new CapabilityError(`Video ${args.videoId} not found on YouTube.`, 'not_found')
      }

      await meteredCall('videos.update', () =>
        data.videos.update({
          part: ['snippet'],
          requestBody: {
            id: args.videoId,
            snippet: {
              ...snippet,
              title: args.title ?? snippet.title,
              description: args.description ?? snippet.description,
              tags: args.tags ?? snippet.tags,
              categoryId: snippet.categoryId,
            },
          },
        })
      )

      // Keep the cache honest immediately rather than waiting for the next sync.
      const db = (await import('../../db/database')).getDatabase()
      db.prepare(
        `UPDATE yt_videos SET title = ?, description = ?, tags_json = ? WHERE id = ?`
      ).run(
        args.title ?? snippet.title ?? '',
        args.description ?? snippet.description ?? '',
        JSON.stringify(args.tags ?? snippet.tags ?? []),
        args.videoId
      )

      return { videoId: args.videoId, updated: Object.keys(args).filter((k) => k !== 'videoId') }
    },
    formatResult: (r: { videoId: string; updated: string[] }) =>
      `Updated ${r.updated.join(', ')} on video ${r.videoId}.`,
  },

  {
    id: 'youtube.deleteVideo',
    title: 'Delete a video',
    description:
      'Permanently delete a video from YouTube. This cannot be undone — there is no trash and no restore, ' +
      'and the video\'s comments and analytics history go with it. Takes a video id, never a title: call ' +
      'youtube.listVideos first to resolve one, and show the user which video you matched before proposing ' +
      'the deletion. Costs 51 quota units.',
    risk: 'destructive',
    requiresGoogle: true,
    schema: deleteVideoSchema,
    approval: {
      summary: (args: z.infer<typeof deleteVideoSchema>) => {
        const video = getVideo(args.videoId)
        return (
          `Permanently delete "${video?.title ?? args.videoId}" from YouTube — ` +
          'this cannot be undone, and its comments and analytics go with it'
        )
      },
      diff: (args: z.infer<typeof deleteVideoSchema>) => {
        const video = getVideo(args.videoId)
        if (!video) return null

        const published = video.publishedAt
          ? new Date(video.publishedAt).toISOString().slice(0, 10)
          : 'unknown date'
        return {
          subject: video.title,
          // `after: null` renders as a removal rather than a change, which is
          // the distinction that matters on a card the user cannot take back.
          changes: [
            {
              field: 'video',
              before: `${video.title} — ${video.viewCount.toLocaleString()} views, published ${published}`,
              after: null,
            },
          ],
        }
      },
    },
    handler: async (args: z.infer<typeof deleteVideoSchema>) => {
      const { data } = getYouTubeClients()

      // The approval card was rendered from the local cache, which can be
      // stale. Re-read the live title and refuse on any mismatch: the failure
      // being guarded against is the user approving "delete X" and losing Y,
      // and one quota unit is a trivial price for making that impossible.
      const current = await meteredCall('videos.list', () =>
        data.videos.list({ part: ['snippet'], id: [args.videoId] })
      )
      const liveTitle = current.data.items?.[0]?.snippet?.title
      if (liveTitle === undefined) {
        throw new CapabilityError(
          `Video ${args.videoId} was not found on YouTube — it may already be deleted.`,
          'not_found'
        )
      }

      const cached = getVideo(args.videoId)
      if (cached && cached.title !== liveTitle) {
        throw new CapabilityError(
          `Refusing to delete ${args.videoId}: the approval showed "${cached.title}" but YouTube now ` +
            `calls it "${liveTitle}". Run a sync so you are deciding about the right video, then try again.`,
          'handler_failed'
        )
      }

      await meteredCall('videos.delete', () => data.videos.delete({ id: args.videoId }))

      // Only after YouTube confirms. Dropping the cache row first would leave
      // the app unable to name a video that still exists if the delete failed.
      deleteVideoFromCache(args.videoId)

      return { videoId: args.videoId, title: liveTitle }
    },
    formatResult: (r: { videoId: string; title: string }) =>
      `Deleted "${r.title}" (${r.videoId}) from YouTube. This cannot be undone.`,
  },
]
