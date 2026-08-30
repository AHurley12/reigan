import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tempDir = mkdtempSync(join(tmpdir(), 'reigan-yt-delcap-'))
process.env.REIGAN_TEST_USERDATA = tempDir

/**
 * The video that `videos.list` will claim is live, and a log of what was
 * actually deleted. Only the googleapis client is faked — `meteredCall` runs
 * for real so quota accounting is exercised alongside the delete.
 */
let liveTitle: string | null = 'Doomed'
const deleted: string[] = []

vi.mock('../../youtube/api', async (importActual) => {
  const actual = await importActual<typeof import('../../youtube/api')>()
  return {
    ...actual,
    getYouTubeClients: () => ({
      data: {
        videos: {
          list: async () => ({
            data: { items: liveTitle === null ? [] : [{ snippet: { title: liveTitle } }] },
          }),
          delete: async ({ id }: { id: string }) => {
            deleted.push(id)
            return {}
          },
        },
      },
      analytics: {},
    }),
  }
})

const { getDatabase, closeDatabase } = await import('../../db/database')
const { youtubeCapabilities } = await import('./youtube')
const { QUOTA_COSTS } = await import('../../youtube/quota')

const deleteVideo = youtubeCapabilities.find((c) => c.id === 'youtube.deleteVideo')!
const ctx = { invokedBy: 'ui' } as const

function addVideo(id: string, title: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO yt_videos
         (id, title, description, published_at, duration_s, privacy_status, thumbnail_url,
          has_custom_thumbnail, tags_json, category_id, view_count, like_count, comment_count, synced_at)
       VALUES (?, ?, 'd', ?, 600, 'public', null, 1, '[]', '22', 4200, 0, 0, ?)`
    )
    .run(id, title, Date.now(), Date.now())
}

const videoRows = (id: string): number =>
  (getDatabase().prepare('SELECT COUNT(*) AS n FROM yt_videos WHERE id = ?').get(id) as { n: number })
    .n

afterAll(() => {
  closeDatabase()
  rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(() => {
  getDatabase().exec('DELETE FROM yt_videos')
  deleted.length = 0
  liveTitle = 'Doomed'
})

describe('youtube.deleteVideo', () => {
  it('is declared destructive, not write', () => {
    // The registry gives destructive capabilities a stronger approval card.
    // Deleting a video has no undo, so the weaker tier would understate it.
    expect(deleteVideo.risk).toBe('destructive')
  })

  it('charges the documented quota cost', () => {
    expect(QUOTA_COSTS['videos.delete']).toBe(50)
  })

  it('deletes on YouTube and then drops the cache row', async () => {
    addVideo('vid-1', 'Doomed')

    await deleteVideo.handler({ videoId: 'vid-1' }, ctx)

    expect(deleted).toEqual(['vid-1'])
    expect(videoRows('vid-1')).toBe(0)
  })

  it('refuses when the live title differs from the approved one', async () => {
    // The approval card is rendered from the local cache. If the cache is
    // stale the user approves one title and a different video dies, so the
    // handler re-reads the live title and stops rather than guessing.
    addVideo('vid-1', 'Doomed')
    liveTitle = 'Something Else Entirely'

    await expect(deleteVideo.handler({ videoId: 'vid-1' }, ctx)).rejects.toThrow(/sync/i)

    expect(deleted).toEqual([])
    expect(videoRows('vid-1')).toBe(1)
  })

  it('reports not_found when the video is already gone from YouTube', async () => {
    addVideo('vid-1', 'Doomed')
    liveTitle = null

    await expect(deleteVideo.handler({ videoId: 'vid-1' }, ctx)).rejects.toThrow(/not found/i)

    expect(deleted).toEqual([])
  })

  it('names the video and says it cannot be undone on the approval card', () => {
    addVideo('vid-1', 'Doomed')

    const summary = deleteVideo.approval!.summary({ videoId: 'vid-1' })

    expect(summary).toContain('Doomed')
    expect(summary).toMatch(/cannot be undone/i)
  })

  it('shows the deletion as a removal in the diff', async () => {
    addVideo('vid-1', 'Doomed')

    const diff = await deleteVideo.approval!.diff!({ videoId: 'vid-1' })

    expect(diff!.subject).toBe('Doomed')
    // `after: null` is what makes the card read as removal rather than change.
    expect(diff!.changes[0].after).toBeNull()
  })
})
