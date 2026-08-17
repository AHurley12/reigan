import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Table2, LineChart } from 'lucide-react'
import type { YtSeriesPoint } from '../../../../shared/types'

/**
 * Views, likes and comments over the selected window.
 *
 * ── Why three stacked panels and not one chart with three lines ──
 *
 * A channel that takes 20,000 views a day takes maybe 600 likes and 30
 * comments. Drawn against a single linear axis, likes and comments are two flat
 * lines welded to the baseline: technically plotted, actually unreadable.
 *
 * The usual escape is a second y-axis. That is worse, not better — with two
 * scales the crossing points are an artefact of where the axes were cropped,
 * so the chart invents a relationship between views and comments that the data
 * never contained, and the reader has no way to see that it did.
 *
 * So: small multiples. Each metric gets its own panel and its own y-scale, and
 * every panel shares the x-axis and a single crosshair. Comparison across
 * metrics stays honest — it happens along time, which really is common to all
 * three — while each series keeps the vertical range it needs to show its own
 * shape. The cost is that panel heights are not comparable to each other, which
 * is why no panel claims otherwise: each states its own peak.
 */

interface Props {
  points: YtSeriesPoint[]
  /** Window length in days, for labelling the axis and the comparison. */
  rangeDays: number
  /** Re-fetches the full history. Offered from the panels that a backfill would
      actually populate — see `backfillable`. */
  onBackfill?: () => void
  backfilling?: boolean
}

interface SeriesDef {
  key: 'views' | 'likes' | 'comments'
  label: string
  /** Fixed slot from the theme's categorical triad. Bound to the metric, never
      to its rank, so the colours never shuffle when a range changes. */
  color: string
  /** Shown when the metric has no data at all, which is its own state. */
  emptyHint: string
  /**
   * Whether an empty panel is worth offering a full sync for.
   *
   * Likes and comments were added to the daily sync after the fact, so an empty
   * panel there usually means "never collected", which a backfill fixes. Empty
   * views cannot mean that — views have always been fetched — so it means the
   * channel genuinely had none, and offering a sync would just waste quota to
   * confirm a zero.
   */
  backfillable: boolean
}

const SERIES: SeriesDef[] = [
  {
    key: 'views',
    label: 'Views',
    color: 'var(--chart-series1)',
    emptyHint: 'No views recorded in this window.',
    backfillable: false,
  },
  {
    key: 'likes',
    label: 'Likes',
    color: 'var(--chart-series2)',
    emptyHint: 'No daily likes collected for this window yet.',
    backfillable: true,
  },
  {
    key: 'comments',
    label: 'Comments',
    color: 'var(--chart-series3)',
    emptyHint: 'No daily comments collected for this window yet.',
    backfillable: true,
  },
]

const PLOT_H = 104
const TOP_PAD = 10

/** 12.4K / 3.1M — for hero figures and peak labels, where width is scarce. */
function compact(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K`
  return String(Math.round(n))
}

/** Axis ticks: months once the window is long enough that days would collide. */
function formatTick(iso: string, rangeDays: number): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return rangeDays > 365
    ? d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** The crosshair readout, which always names a specific day whatever the range. */
function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * Width of the plot column in px, so marks are laid out in real pixels rather
 * than a stretched viewBox — a non-uniform scale would distort dots and text.
 *
 * The ref goes on a zero-height probe that sits inside the same padding the
 * plots do, so it reports the drawable width and the drawable left edge. The
 * pointer maths reads the same rect, which is what keeps the crosshair under
 * the cursor instead of offset by the panel's inset.
 */
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    setWidth(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}

/**
 * Trailing-window change: the most recent `half` days against the `half` days
 * before them, inside the same window the user selected.
 *
 * Returned with the span it used so the label can say which two stretches were
 * compared. A bare "+12%" that silently changes meaning with the range is the
 * kind of number people quote in a meeting.
 */
function trend(values: number[]): { pct: number; span: number } | null {
  const half = Math.min(Math.floor(values.length / 2), 28)
  if (half < 3) return null

  const recent = values.slice(-half).reduce((a, b) => a + b, 0)
  const prior = values.slice(-half * 2, -half).reduce((a, b) => a + b, 0)
  if (prior === 0) return null

  return { pct: ((recent - prior) / prior) * 100, span: half }
}

function Panel({
  def,
  values,
  width,
  hovered,
  gradientId,
}: {
  def: SeriesDef
  values: number[]
  width: number
  hovered: number | null
  gradientId: string
}) {
  const total = values.reduce((a, b) => a + b, 0)
  const peak = Math.max(...values, 0)
  const change = trend(values)
  const empty = peak === 0

  // The scale is anchored at zero rather than at the minimum. A view count is a
  // magnitude, and cropping the baseline to make a 3% wobble look like a cliff
  // is the oldest way to mislead with a line chart.
  const scale = peak || 1

  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width)
  const y = (v: number) => TOP_PAD + (1 - v / scale) * (PLOT_H - TOP_PAD)

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
  const area = `${line} L${x(values.length - 1).toFixed(2)},${PLOT_H} L${x(0).toFixed(2)},${PLOT_H} Z`

  const active = hovered !== null && hovered < values.length ? hovered : null
  const roomy = width >= 420

  return (
    <div className="rule-b px-6 py-3 flex flex-col gap-2">
      <div className="flex items-baseline gap-2.5 whitespace-nowrap">
        <span
          className="shrink-0 rounded-full"
          style={{ width: 7, height: 7, background: def.color }}
          aria-hidden
        />
        <span
          className="font-mono text-[10px] uppercase tracking-wide"
          style={{ color: 'var(--text-muted)' }}
        >
          {def.label}
        </span>

        {/* The hero figure tracks the crosshair: with a pointer on the chart it
            reads that day, otherwise the window total. The date itself is named
            once in the chart header rather than repeated in all three panels. */}
        <span className="font-display text-lg tabular-nums" style={{ color: 'var(--text-primary)' }}>
          {active !== null ? values[active].toLocaleString() : total.toLocaleString()}
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {active !== null ? 'that day' : 'total'}
        </span>

        {/* Both trailing labels are secondary to the figure beside them, so they
            are dropped rather than wrapped once the panel is too narrow to seat
            them on one line. Everything they say is still reachable — the peak
            is the dashed rule, and the whole series is in the table view. */}
        {change && active === null && roomy && (
          <span
            className="font-mono text-[10px] ml-auto tabular-nums whitespace-nowrap"
            style={{ color: 'var(--text-secondary)' }}
            title={`Last ${change.span} days against the ${change.span} days before them`}
          >
            {change.pct >= 0 ? '↑' : '↓'} {Math.abs(change.pct).toFixed(0)}%
            <span style={{ color: 'var(--text-muted)' }}> vs prev {change.span}d</span>
          </span>
        )}
        {!empty && active === null && roomy && (
          <span
            className="font-mono text-[10px] tabular-nums whitespace-nowrap"
            style={{ color: 'var(--text-muted)', marginLeft: change ? 0 : 'auto' }}
          >
            peak {compact(peak)}
          </span>
        )}
      </div>

      <div className="relative" style={{ height: PLOT_H }}>
        {empty ? (
          <div
            className="absolute inset-0 flex items-center gap-3 font-mono text-[11px]"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>{def.emptyHint}</span>
            {def.backfillable && onBackfill && (
              <button
                onClick={onBackfill}
                disabled={backfilling}
                className="px-2 py-1 rounded transition-colors text-txt-secondary hover:text-txt-primary disabled:opacity-50"
                style={{ border: '1px solid var(--border-subtle)' }}
                title="Re-fetch 365 days of history. Costs YouTube Analytics quota."
              >
                {backfilling ? 'Syncing…' : 'Run full sync'}
              </button>
            )}
          </div>
        ) : (
          width > 0 && (
            <svg
              width={width}
              height={PLOT_H}
              className="block overflow-visible"
              role="img"
              aria-label={`${def.label} per day. Total ${total.toLocaleString()}, peak ${peak.toLocaleString()}. Full figures are in the table view.`}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={def.color} stopOpacity="0.26" />
                  <stop offset="100%" stopColor={def.color} stopOpacity="0" />
                </linearGradient>
              </defs>

              {/* Baseline and peak, both recessive — the marks carry the chart,
                  the grid only has to be findable. */}
              <line
                x1={0}
                x2={width}
                y1={PLOT_H - 0.5}
                y2={PLOT_H - 0.5}
                stroke="var(--border-subtle)"
                strokeWidth={1}
              />
              <line
                x1={0}
                x2={width}
                y1={TOP_PAD}
                y2={TOP_PAD}
                stroke="var(--border-subtle)"
                strokeWidth={1}
                strokeDasharray="2 4"
              />

              <path d={area} fill={`url(#${gradientId})`} />
              <path
                d={line}
                fill="none"
                stroke={def.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />

              {active !== null && (
                <g>
                  <line
                    x1={x(active)}
                    x2={x(active)}
                    y1={0}
                    y2={PLOT_H}
                    stroke="var(--border-strong)"
                    strokeWidth={1}
                  />
                  {/* A surface-coloured ring keeps the dot legible where it lands
                      on top of the line it belongs to. */}
                  <circle
                    cx={x(active)}
                    cy={y(values[active])}
                    r={4.5}
                    fill={def.color}
                    stroke="var(--surface-raised)"
                    strokeWidth={2}
                  />
                </g>
              )}
            </svg>
          )
        )}
      </div>
    </div>
  )
}

function TrendsTable({ points }: { points: YtSeriesPoint[] }) {
  return (
    <div className="px-6 py-3 overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <caption className="sr-only">Daily views, likes and comments for the selected window</caption>
        <thead>
          <tr>
            {['Date', 'Views', 'Likes', 'Comments'].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={`font-mono text-[10px] uppercase tracking-wide pb-2 ${i === 0 ? '' : 'text-right'}`}
                style={{ color: 'var(--text-muted)' }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...points].reverse().map((p) => (
            <tr key={p.date}>
              <th
                scope="row"
                className="font-mono text-[11px] font-normal py-1"
                style={{ color: 'var(--text-secondary)' }}
              >
                {p.date}
              </th>
              {[p.views, p.likes, p.comments].map((v, i) => (
                <td
                  key={i}
                  className="font-mono text-[11px] py-1 text-right tabular-nums"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {v.toLocaleString()}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ChannelTrends({ points, rangeDays }: Props) {
  const [probeRef, width] = useMeasuredWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const baseId = useId()

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const el = probeRef.current
      if (!el || points.length === 0) return
      // Measured against the probe, i.e. the plot column itself. Using the
      // panel's own box instead would offset the crosshair from the cursor by
      // exactly the horizontal padding.
      const rect = el.getBoundingClientRect()
      if (rect.width === 0) return
      const ratio = (e.clientX - rect.left) / rect.width
      const i = Math.round(ratio * (points.length - 1))
      setHovered(Math.max(0, Math.min(points.length - 1, i)))
    },
    [probeRef, points.length]
  )

  if (points.length === 0) {
    return (
      <div className="px-6 py-8 text-center font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
        No daily data in this window yet.
      </div>
    )
  }

  if (points.length === 1) {
    // One point is a reading, not a trend; drawing a line through it would
    // suggest a direction that was never measured.
    const p = points[0]
    return (
      <div className="px-6 py-6 flex gap-8">
        {SERIES.map((def) => (
          <div key={def.key} className="flex flex-col gap-1">
            <span
              className="font-mono text-[10px] uppercase tracking-wide"
              style={{ color: 'var(--text-muted)' }}
            >
              {def.label}
            </span>
            <span className="font-display text-xl" style={{ color: 'var(--text-primary)' }}>
              {p[def.key].toLocaleString()}
            </span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {formatDay(p.date)} — one day only
            </span>
          </div>
        ))}
      </div>
    )
  }

  const tickCount = Math.min(5, points.length)
  const ticks = Array.from({ length: tickCount }, (_, i) =>
    Math.round((i / (tickCount - 1)) * (points.length - 1))
  )

  return (
    <div className="flex flex-col">
      <div className="px-6 pt-4 pb-1 flex items-center justify-between">
        <span
          className="font-mono text-[10px] uppercase tracking-wide whitespace-nowrap overflow-hidden text-ellipsis"
          style={{ color: 'var(--text-muted)' }}
        >
          Daily performance
          {hovered !== null && points[hovered] && (
            <span style={{ color: 'var(--text-secondary)' }}> · {formatDay(points[hovered].date)}</span>
          )}
        </span>
        <button
          onClick={() => setAsTable((v) => !v)}
          className="flex items-center gap-1.5 px-2 py-1 rounded font-mono text-[10px] transition-colors text-txt-muted hover:text-txt-secondary"
          aria-pressed={asTable}
        >
          {asTable ? <LineChart size={12} /> : <Table2 size={12} />}
          {asTable ? 'Chart' : 'Table'}
        </button>
      </div>

      {/* Zero-height probe, inset exactly as the plots are. Deliberately outside
          the branch below: were it to unmount with the chart, the observer would
          be left watching a detached node, and a window resize made while the
          table was showing would never reach the plots. */}
      <div className="px-6" aria-hidden>
        <div ref={probeRef} className="h-0" />
      </div>

      {asTable ? (
        <TrendsTable points={points} />
      ) : (
        <div
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHovered(null)}
          className="flex flex-col"
        >
          {SERIES.map((def) => (
            <Panel
              key={def.key}
              def={def}
              values={points.map((p) => p[def.key])}
              width={width}
              hovered={hovered}
              gradientId={`${baseId}-${def.key}`}
            />
          ))}

          <div className="px-6 pt-2 pb-4 flex justify-between">
            {ticks.map((i) => (
              <span
                key={i}
                className="font-mono text-[10px] tabular-nums"
                style={{ color: 'var(--text-muted)' }}
              >
                {formatTick(points[i].date, rangeDays)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
