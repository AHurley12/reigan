import { describe, expect, it } from 'vitest'
import { parseReachCsv } from './reachCsv'

const header = 'date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr'

describe('parseReachCsv', () => {
  it('reads a report into dated per-video rows', () => {
    const rows = parseReachCsv(`${header}\n20260815,UC123,vid-a,4000,0.043\n`)

    expect(rows).toEqual([{ date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.043 }])
  })

  it('accepts an already-hyphenated date', () => {
    // Google's docs do not pin the format down, so both are handled rather than
    // guessed at.
    const rows = parseReachCsv(`${header}\n2026-08-15,UC123,vid-a,4000,0.043\n`)

    expect(rows[0].date).toBe('2026-08-15')
  })

  it('normalises a percentage CTR to a fraction', () => {
    // The metric is documented as a "percentage" and defined as "clicks divided
    // by impressions", which are different scales. audit.ts multiplies by 100,
    // so anything above 1 must be a percentage.
    const rows = parseReachCsv(`${header}\n20260815,UC123,vid-a,4000,4.3\n`)

    expect(rows[0].ctr).toBeCloseTo(0.043)
  })

  it('finds columns by header name rather than position', () => {
    const reordered = 'video_thumbnail_impressions_ctr,video_id,date,video_thumbnail_impressions'
    const rows = parseReachCsv(`${reordered}\n0.043,vid-a,20260815,4000\n`)

    expect(rows[0]).toEqual({ date: '2026-08-15', videoId: 'vid-a', impressions: 4000, ctr: 0.043 })
  })

  it('unwraps quoted fields', () => {
    const rows = parseReachCsv(`${header}\n"20260815","UC123","vid-a","4000","0.043"\n`)

    expect(rows[0].videoId).toBe('vid-a')
    expect(rows[0].impressions).toBe(4000)
  })

  it('returns nothing for an empty or header-only report', () => {
    expect(parseReachCsv('')).toEqual([])
    expect(parseReachCsv(`${header}\n`)).toEqual([])
  })

  it('skips a row with a missing video id or unparseable numbers', () => {
    const rows = parseReachCsv(
      `${header}\n20260815,UC123,,4000,0.043\n20260815,UC123,vid-b,not-a-number,0.043\n` +
        '20260815,UC123,vid-c,900,0.02\n'
    )

    expect(rows.map((r) => r.videoId)).toEqual(['vid-c'])
  })

  it('throws when the file is not a reach report at all', () => {
    // A silent empty array here would look exactly like "no data yet" and hide a
    // report type change behind a job that reports success forever.
    expect(() => parseReachCsv('views,likes\n10,2\n')).toThrow(/video_thumbnail_impressions/)
  })
})
