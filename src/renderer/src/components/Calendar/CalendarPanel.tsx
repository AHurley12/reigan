import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useIPC } from '../../hooks/useIPC'
import { SectionHeader } from '../shared/SectionHeader'
import type { CalendarEvent } from '../../../../shared/types'

const HOUR_START = 6
const HOUR_END = 23
const ROW_HEIGHT = 48 // px per hour
const GRID_HEIGHT = (HOUR_END - HOUR_START) * ROW_HEIGHT

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function eventColor(title: string): string {
  if (/\bawp\b|work/i.test(title)) return 'var(--reigan-primary)'
  if (/study/i.test(title)) return 'var(--active)'
  return 'var(--info)'
}

function formatWeekRange(weekStart: Date): string {
  const weekEnd = addDays(weekStart, 6)
  const startLabel = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const endLabel = weekEnd.toLocaleDateString('en-US', { day: 'numeric' })
  return `${startLabel}–${endLabel}`
}

interface PositionedEvent extends CalendarEvent {
  top: number
  height: number
}

export function CalendarPanel() {
  const ipc = useIPC()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [connected, setConnected] = useState(true)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CalendarEvent | null>(null)
  const [now, setNow] = useState(new Date())

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    setLoading(true)
    const rangeStart = weekStart.toISOString()
    const rangeEnd = addDays(weekStart, 7).toISOString()

    ipc.calendar
      .listEvents(rangeStart, rangeEnd)
      .then((result) => {
        if (cancelled) return
        setConnected(result.connected)
        setEvents(result.events)
      })
      .catch(() => {
        if (!cancelled) setConnected(false)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [ipc, weekStart])

  const eventsByDay = useMemo(() => {
    const byDay: { timed: PositionedEvent[]; allDay: CalendarEvent[] }[] = days.map(() => ({ timed: [], allDay: [] }))

    for (const ev of events) {
      const start = new Date(ev.start)
      const dayIndex = days.findIndex((d) => isSameDay(d, start))
      if (dayIndex === -1) continue

      if (ev.allDay) {
        byDay[dayIndex].allDay.push(ev)
        continue
      }

      const end = new Date(ev.end)
      const startHour = Math.max(HOUR_START, start.getHours() + start.getMinutes() / 60)
      const endHour = Math.min(HOUR_END, Math.max(startHour + 0.5, end.getHours() + end.getMinutes() / 60))
      byDay[dayIndex].timed.push({
        ...ev,
        top: (startHour - HOUR_START) * ROW_HEIGHT,
        height: Math.max(20, (endHour - startHour) * ROW_HEIGHT - 2),
      })
    }

    return byDay
  }, [events, days])

  const todayIndex = days.findIndex((d) => isSameDay(d, now))
  const nowLineTop =
    todayIndex >= 0 ? (now.getHours() + now.getMinutes() / 60 - HOUR_START) * ROW_HEIGHT : -1

  return (
    <div className="relative flex flex-col h-full" onClick={() => setSelected(null)}>
      <div className="flex items-center justify-between px-6 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <SectionHeader en="Calendar" ja="カレンダー" />
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setWeekStart((w) => addDays(w, -7)) }}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Previous week"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs font-mono min-w-[110px] text-center" style={{ color: 'var(--text-secondary)' }}>
            {formatWeekRange(weekStart)}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); setWeekStart((w) => addDays(w, 7)) }}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Next week"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {!connected ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Google Calendar isn't connected.</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Connect your Google account in Settings (Ctrl+,) to see events here.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Day headers */}
          <div className="grid sticky top-0 z-10" style={{ gridTemplateColumns: '48px repeat(7, 1fr)', background: 'var(--bg-void)' }}>
            <div />
            {days.map((d, i) => {
              const isToday = isSameDay(d, now)
              return (
                <div key={i} className="text-center pb-2">
                  <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div
                    className="text-sm font-medium mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full"
                    style={{
                      color: isToday ? 'white' : 'var(--text-primary)',
                      background: isToday ? 'var(--reigan-gradient)' : 'transparent',
                    }}
                  >
                    {d.getDate()}
                  </div>
                </div>
              )
            })}
          </div>

          {/* All-day events */}
          {eventsByDay.some((d) => d.allDay.length > 0) && (
            <div className="grid mb-2" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
              <div />
              {eventsByDay.map((d, i) => (
                <div key={i} className="px-0.5 space-y-1">
                  {d.allDay.map((ev) => (
                    <div
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); setSelected(ev) }}
                      className="text-[10px] rounded px-1.5 py-0.5 truncate cursor-pointer"
                      style={{ background: `${eventColor(ev.title)}33`, color: 'var(--text-primary)' }}
                    >
                      {ev.title}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Hour grid */}
          <div className="grid" style={{ gridTemplateColumns: '48px repeat(7, 1fr)' }}>
            <div style={{ height: GRID_HEIGHT }}>
              {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                <div key={i} className="text-[10px] pr-2 text-right -translate-y-2" style={{ height: ROW_HEIGHT, color: 'var(--text-muted)' }}>
                  {(() => {
                    const h = HOUR_START + i
                    const period = h < 12 ? 'AM' : 'PM'
                    const h12 = h % 12 === 0 ? 12 : h % 12
                    return `${h12}${period}`
                  })()}
                </div>
              ))}
            </div>

            {eventsByDay.map((d, dayIndex) => (
              <div
                key={dayIndex}
                className="relative"
                style={{ height: GRID_HEIGHT, borderLeft: '1px solid var(--border)' }}
              >
                {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                  <div key={i} style={{ height: ROW_HEIGHT, borderTop: '1px solid var(--border)' }} />
                ))}

                {d.timed.map((ev) => (
                  <div
                    key={ev.id}
                    onClick={(e) => { e.stopPropagation(); setSelected(ev) }}
                    className="absolute left-0.5 right-0.5 rounded px-1.5 py-0.5 overflow-hidden cursor-pointer text-[10px] leading-tight transition-opacity hover:opacity-90"
                    style={{ top: ev.top, height: ev.height, background: eventColor(ev.title), color: 'white' }}
                  >
                    <div className="font-medium truncate">{ev.title}</div>
                    <div className="opacity-80 truncate">
                      {new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </div>
                  </div>
                ))}

                {dayIndex === todayIndex && nowLineTop >= 0 && nowLineTop <= GRID_HEIGHT && (
                  <div className="absolute left-0 right-0 pointer-events-none" style={{ top: nowLineTop, borderTop: '1.5px solid #EF4444' }} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {selected && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-6 top-20 z-20 w-64 rounded-lg p-4 space-y-2 shadow-lg"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{selected.title}</p>
            <button onClick={() => setSelected(null)} style={{ color: 'var(--text-muted)' }} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {new Date(selected.start).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            {' → '}
            {new Date(selected.end).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </p>
          {selected.location && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selected.location}</p>
          )}
          {selected.description && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{selected.description}</p>
          )}
        </div>
      )}

      {loading && (
        <div className="absolute top-4 right-6 text-[10px]" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      )}
    </div>
  )
}
