import { useEffect, useMemo, useState } from 'react'
import {
  Inbox, Users, Tag, Bell, MessagesSquare,
  Star, Archive, Reply, RefreshCw, ArrowLeft, Send, Mail as MailIcon,
} from 'lucide-react'
import { useIPC } from '../../hooks/useIPC'
import { SectionHeader } from '../shared/SectionHeader'
import { useToastStore } from '../../stores/toastStore'
import type { MailCategory, MailThread, MailThreadDetail } from '../../../../shared/types'

type SortMode = 'newest' | 'oldest' | 'unread' | 'sender'

const CATEGORIES: { key: MailCategory; label: string; ja: string; icon: typeof Inbox }[] = [
  { key: 'primary', label: 'Primary', ja: 'メイン', icon: Inbox },
  { key: 'social', label: 'Social', ja: 'SNS', icon: Users },
  { key: 'promotions', label: 'Promotions', ja: '広告', icon: Tag },
  { key: 'updates', label: 'Updates', ja: '更新', icon: Bell },
  { key: 'forums', label: 'Forums', ja: '掲示板', icon: MessagesSquare },
]

const SORT_LABELS: Record<SortMode, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  unread: 'Unread first',
  sender: 'Sender A–Z',
}

const EMPTY_COUNTS: Record<MailCategory, number> = {
  primary: 0, social: 0, promotions: 0, updates: 0, forums: 0,
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function avatarColor(seed: string): string {
  const palette = ['var(--reigan-primary)', 'var(--reigan-secondary)', 'var(--gold)', 'var(--info)']
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  return palette[hash % palette.length]
}

function relativeDate(raw: string): string {
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Date.now() - date.getTime()
  const diffMin = diffMs / 60000
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${Math.floor(diffMin)}m`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h`
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function sortThreads(threads: MailThread[], mode: SortMode): MailThread[] {
  const withTime = threads.map((t) => ({ t, ts: new Date(t.date).getTime() || 0 }))
  switch (mode) {
    case 'oldest':
      withTime.sort((a, b) => a.ts - b.ts)
      break
    case 'unread':
      withTime.sort((a, b) => Number(b.t.unread) - Number(a.t.unread) || b.ts - a.ts)
      break
    case 'sender':
      withTime.sort((a, b) => a.t.fromName.localeCompare(b.t.fromName))
      break
    default:
      withTime.sort((a, b) => b.ts - a.ts)
  }
  return withTime.map((w) => w.t)
}

export function MailPanel() {
  const ipc = useIPC()
  const push = useToastStore((s) => s.push)

  const [connected, setConnected] = useState(true)
  const [category, setCategory] = useState<MailCategory>('primary')
  const [threads, setThreads] = useState<MailThread[]>([])
  const [counts, setCounts] = useState<Record<MailCategory, number>>(EMPTY_COUNTS)
  const [sortMode, setSortMode] = useState<SortMode>('newest')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<MailThreadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [replyBody, setReplyBody] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    setLoading(true)

    ipc.mail
      .listThreads({ category, unreadOnly })
      .then((result) => {
        if (cancelled) return
        setConnected(result.connected)
        setThreads(result.threads)
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
  }, [ipc, category, unreadOnly, refreshTick])

  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    ipc.mail
      .categoryCounts()
      .then((result) => {
        if (!cancelled) setCounts(result.counts)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [ipc, refreshTick])

  useEffect(() => {
    if (!ipc || !selectedId) {
      setSelectedDetail(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    setReplyBody('')

    ipc.mail
      .getThread(selectedId)
      .then((detail) => {
        if (cancelled) return
        setSelectedDetail(detail)
        // Reading the thread clears its unread state server-side — mirror locally.
        setThreads((prev) => prev.map((t) => (t.id === selectedId ? { ...t, unread: false } : t)))
      })
      .catch(() => {
        if (!cancelled) push('Could not load that message.', 'error')
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [ipc, selectedId, push])

  const sortedThreads = useMemo(() => sortThreads(threads, sortMode), [threads, sortMode])
  const selectedThread = threads.find((t) => t.id === selectedId) || null

  const refresh = (): void => setRefreshTick((n) => n + 1)

  const handleArchive = async (threadId: string): Promise<void> => {
    if (!ipc) return
    try {
      await ipc.mail.archive(threadId)
      setThreads((prev) => prev.filter((t) => t.id !== threadId))
      if (selectedId === threadId) setSelectedId(null)
      push('Thread archived.', 'success')
    } catch {
      push('Could not archive that thread.', 'error')
    }
  }

  const handleToggleRead = async (thread: MailThread): Promise<void> => {
    if (!ipc) return
    const nextRead = thread.unread
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread: !nextRead } : t)))
    try {
      await ipc.mail.setRead(thread.id, nextRead)
    } catch {
      setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread: nextRead } : t)))
      push('Could not update read status.', 'error')
    }
  }

  const handleSendReply = async (): Promise<void> => {
    if (!ipc || !selectedThread || !selectedDetail || !replyBody.trim()) return
    const lastMessage = selectedDetail.messages[selectedDetail.messages.length - 1]
    setSending(true)
    try {
      await ipc.mail.reply({
        threadId: selectedThread.id,
        to: selectedThread.from,
        subject: selectedThread.subject,
        body: replyBody.trim(),
      })
      push(`Reply sent to ${selectedThread.fromName}.`, 'success')
      setReplyBody('')
      setSelectedDetail({
        ...selectedDetail,
        messages: [
          ...selectedDetail.messages,
          { id: `local-${Date.now()}`, from: 'me', to: lastMessage?.from || selectedThread.from, date: new Date().toString(), body: replyBody.trim(), snippet: replyBody.trim() },
        ],
      })
    } catch {
      push('Could not send that reply.', 'error')
    } finally {
      setSending(false)
    }
  }

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
        <MailIcon size={28} style={{ color: 'var(--text-muted)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Google Mail isn't connected.</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Connect your Google account in Settings (Ctrl+,) to see your inbox here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full">
      {/* Thread list column */}
      <div className={`flex flex-col shrink-0 ${selectedId ? 'rule-r' : ''}`} style={{ width: selectedId ? 380 : '100%' }}>
        <div className="rule-b flex items-center justify-between px-6 py-4 shrink-0">
          <SectionHeader en="Mail" ja="メール" romaji="meeru" />
          <button
            onClick={refresh}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-tint/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin-slow' : ''} />
          </button>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-4 pt-3 overflow-x-auto">
          {CATEGORIES.map((c) => {
            const Icon = c.icon
            const active = category === c.key
            const count = counts[c.key]
            return (
              <button
                key={c.key}
                onClick={() => { setCategory(c.key); setSelectedId(null) }}
                className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap transition-colors shrink-0"
                style={{
                  background: active ? 'color-mix(in srgb, var(--accent-secondary) 14%, transparent)' : 'transparent',
                  border: `1px solid ${active ? 'var(--reigan-secondary)' : 'var(--border)'}`,
                  color: active ? 'var(--reigan-secondary)' : 'var(--text-secondary)',
                }}
              >
                <Icon size={12} />
                {c.label}
                {count > 0 && (
                  <span
                    className="ml-0.5 px-1.5 rounded-full text-[11px] font-mono leading-4"
                    style={{
                      background: active ? 'var(--reigan-secondary)' : 'var(--bg-elevated)',
                      color: active ? 'var(--bg-void)' : 'var(--text-muted)',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <label className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="accent-[--reigan-secondary]"
              style={{ accentColor: 'var(--reigan-secondary)' }}
            />
            Unread only
          </label>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="text-[12px] rounded-md px-2 py-1 bg-transparent focus:outline-none"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => (
              <option key={mode} value={mode} style={{ background: 'var(--bg-elevated)' }}>
                {SORT_LABELS[mode]}
              </option>
            ))}
          </select>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto">
          {sortedThreads.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center px-6">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {unreadOnly ? 'No unread messages here.' : 'Nothing in this category.'}
              </p>
            </div>
          )}

          {sortedThreads.map((thread) => {
            const active = thread.id === selectedId
            return (
              <div
                key={thread.id}
                onClick={() => setSelectedId(thread.id)}
                className="rule-b group flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors"
                style={{
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  borderLeft: `2px solid ${active ? 'var(--reigan-secondary)' : 'transparent'}`,
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0 mt-0.5"
                  style={{ background: `${avatarColor(thread.fromName)}33`, color: avatarColor(thread.fromName) }}
                >
                  {initials(thread.fromName)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className="text-xs truncate"
                      style={{ color: thread.unread ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: thread.unread ? 600 : 400 }}
                    >
                      {thread.fromName}
                    </span>
                    <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {relativeDate(thread.date)}
                    </span>
                  </div>
                  <p
                    className="text-xs truncate mt-0.5"
                    style={{ color: thread.unread ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: thread.unread ? 500 : 400 }}
                  >
                    {thread.subject}
                    {thread.messageCount > 1 && (
                      <span className="ml-1 font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        ({thread.messageCount})
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {thread.snippet}
                  </p>
                </div>

                <div className="flex flex-col items-center gap-1 shrink-0">
                  {thread.unread && (
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: 'var(--reigan-secondary)', boxShadow: '0 0 6px var(--reigan-secondary)' }}
                    />
                  )}
                  {thread.starred && <Star size={11} fill="var(--gold)" style={{ color: 'var(--gold)' }} />}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleArchive(thread.id) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Archive"
                  >
                    <Archive size={12} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Thread detail column */}
      {selectedId && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {detailLoading || !selectedThread ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</span>
            </div>
          ) : (
            <>
              <div className="rule-b flex items-center gap-2 px-6 py-4 shrink-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-tint/5 transition-colors shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Back to list"
                >
                  <ArrowLeft size={15} />
                </button>
                <h2 className="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>
                  {selectedThread.subject}
                </h2>
                <button
                  onClick={() => handleToggleRead(selectedThread)}
                  className="text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-tint/5 shrink-0"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                >
                  {selectedThread.unread ? 'Mark read' : 'Mark unread'}
                </button>
                <button
                  onClick={() => handleArchive(selectedThread.id)}
                  className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-tint/5 transition-colors shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Archive"
                >
                  <Archive size={14} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {selectedDetail?.messages.map((msg) => (
                  <div key={msg.id} className="rounded-lg p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{msg.from}</span>
                      <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {new Date(msg.date).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-xs whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {msg.body}
                    </p>
                  </div>
                ))}
              </div>

              <div className="rule shrink-0 px-6 py-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1 flex items-center gap-1.5 mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Reply size={11} />
                    <span className="text-[11px]">Reply to {selectedThread.fromName}</span>
                  </div>
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder="Write a reply..."
                    rows={2}
                    className="flex-1 resize-none rounded-md px-3 py-2 text-xs bg-elevated
                      placeholder:text-txt-muted text-txt-primary
                      border border-[var(--border)] focus:border-[var(--border-accent)]
                      focus:outline-none transition-colors duration-fast"
                    style={{ fontFamily: 'var(--font-body)', maxHeight: '100px' }}
                  />
                  <button
                    onClick={handleSendReply}
                    disabled={sending || !replyBody.trim()}
                    className="w-9 h-9 rounded-md flex items-center justify-center shrink-0
                      transition-all duration-fast disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: 'var(--reigan-gradient)', color: 'var(--text-on-accent)' }}
                    aria-label="Send reply"
                  >
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
