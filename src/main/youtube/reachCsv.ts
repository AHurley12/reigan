/**
 * Reach-report CSV → rows, and nothing else.
 *
 * Pure on purpose: the two things about this format that Google's documentation
 * does not pin down — the date format and whether the CTR is a percentage or a
 * fraction — are absorbed here, where both readings can be tested without a
 * network round trip or a fixture file.
 */

export interface ReachRow {
  date: string
  videoId: string
  impressions: number
  ctr: number
}

const DATE = 'date'
const VIDEO = 'video_id'
const IMPRESSIONS = 'video_thumbnail_impressions'
const CTR = 'video_thumbnail_impressions_ctr'

export function parseReachCsv(text: string): ReachRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return []

  const header = splitCsvLine(lines[0])
  const at = (name: string): number => header.indexOf(name)
  const dateAt = at(DATE)
  const videoAt = at(VIDEO)
  const impressionsAt = at(IMPRESSIONS)
  const ctrAt = at(CTR)

  // Failing loudly beats returning []: an empty result is indistinguishable from
  // "no data yet", which would let a changed report type sit undetected behind a
  // job that reports success every night.
  if (dateAt < 0 || videoAt < 0 || impressionsAt < 0 || ctrAt < 0) {
    throw new Error(
      `Not a reach report: expected ${IMPRESSIONS} and ${CTR} columns, got "${lines[0]}".`
    )
  }

  const rows: ReachRow[] = []
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line)
    const videoId = cells[videoAt] ?? ''
    const impressions = Number(cells[impressionsAt])
    const ctr = Number(cells[ctrAt])
    const date = normaliseDate(cells[dateAt] ?? '')

    // One malformed row must not cost the other 1,200 in the same file.
    if (!videoId || !date || !Number.isFinite(impressions) || !Number.isFinite(ctr)) continue

    rows.push({ date, videoId, impressions, ctr: normaliseCtr(ctr) })
  }
  return rows
}

/** `20260815` and `2026-08-15` both mean the same day; yt_daily_stats stores the latter. */
function normaliseDate(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length !== 8) return ''
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
}

/** A click-through rate cannot exceed 1, so anything above it arrived as a percentage. */
function normaliseCtr(value: number): number {
  return value > 1 ? value / 100 : value
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"'
        i++
      } else {
        quoted = !quoted
      }
    } else if (ch === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += ch
    }
  }
  cells.push(cell.trim())
  return cells
}
