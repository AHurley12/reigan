import { useEffect, useMemo, useState } from 'react'
import {
  Search, Folder, FolderOpen, File as FileIcon, FileText, Image as ImageIcon,
  Code2, Music, Archive, ChevronRight, Home, ArrowUp, RefreshCw, ExternalLink,
} from 'lucide-react'
import { useIPC } from '../../hooks/useIPC'
import { SectionHeader } from '../shared/SectionHeader'
import { useToastStore } from '../../stores/toastStore'
import { FILE_TYPE_CATEGORIES, categorizeExt } from '../../../../shared/constants'
import type { FileEntry, FileIndexStatus, FileTypeCategoryId } from '../../../../shared/types'

type SortBy = 'name' | 'modified' | 'size'
type ModifiedFilter = 'any' | 'today' | 'week' | 'month'

const MODIFIED_OPTIONS: { key: ModifiedFilter; label: string }[] = [
  { key: 'any', label: 'Any time' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
]

function modifiedAfterMs(filter: ModifiedFilter): number | undefined {
  if (filter === 'any') return undefined
  const now = new Date()
  if (filter === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  }
  if (filter === 'week') return Date.now() - 7 * 24 * 60 * 60 * 1000
  return Date.now() - 30 * 24 * 60 * 60 * 1000
}

function iconForEntry(entry: FileEntry) {
  if (entry.isDir) return Folder
  const category = categorizeExt(entry.ext)
  switch (category) {
    case 'documents': return FileText
    case 'images': return ImageIcon
    case 'code': return Code2
    case 'media': return Music
    case 'archives': return Archive
    default: return FileIcon
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let value = bytes
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 && i > 0 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

function formatDate(ms: number): string {
  if (!ms) return ''
  const date = new Date(ms)
  const diffDays = (Date.now() - ms) / (24 * 60 * 60 * 1000)
  if (diffDays < 1) return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (diffDays < 7) return date.toLocaleDateString('en-US', { weekday: 'short' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: diffDays > 365 ? 'numeric' : undefined })
}

function breadcrumbSegments(currentDir: string, homeDir: string): { label: string; path: string }[] {
  if (!currentDir || !homeDir) return []
  const isHome = currentDir.toLowerCase() === homeDir.toLowerCase()
  if (isHome) return []
  const rel = currentDir.slice(homeDir.length).replace(/^[\\/]/, '')
  if (!rel) return []
  const parts = rel.split(/[\\/]/).filter(Boolean)
  let acc = homeDir
  return parts.map((part) => {
    acc = `${acc}\\${part}`
    return { label: part, path: acc }
  })
}

export function FilesPanel() {
  const ipc = useIPC()
  const push = useToastStore((s) => s.push)

  const [homeDir, setHomeDir] = useState<string | null>(null)
  const [currentDir, setCurrentDir] = useState<string | null>(null)
  const [dirEntries, setDirEntries] = useState<FileEntry[]>([])
  const [searchResults, setSearchResults] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)

  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FileTypeCategoryId>('all')
  const [modifiedFilter, setModifiedFilter] = useState<ModifiedFilter>('any')
  const [sortBy, setSortBy] = useState<SortBy>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [preview, setPreview] = useState<{ content: string; truncated: boolean } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [indexStatus, setIndexStatus] = useState<FileIndexStatus | null>(null)

  const searchMode = query.trim().length > 0

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setQuery(rawQuery), 250)
    return () => clearTimeout(t)
  }, [rawQuery])

  // Resolve the home root from the index status (authoritative — doesn't depend on
  // the directory having any entries) and start browsing there.
  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    ipc.files.indexStatus().then((s) => {
      if (cancelled) return
      setHomeDir(s.homeDir)
      setCurrentDir(s.homeDir)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [ipc])

  // Load current directory contents (Browse mode).
  useEffect(() => {
    if (!ipc || !currentDir || searchMode) return
    let cancelled = false
    setLoading(true)
    ipc.files.listDir(currentDir)
      .then((entries) => { if (!cancelled) setDirEntries(entries) })
      .catch(() => { if (!cancelled) push('Could not read that folder.', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ipc, currentDir, searchMode, push])

  // Run indexed search (Search mode).
  useEffect(() => {
    if (!ipc || !searchMode) return
    let cancelled = false
    setLoading(true)
    ipc.files.search({
      query,
      category,
      modifiedAfter: modifiedAfterMs(modifiedFilter),
      sortBy,
      sortDir,
    })
      .then((results) => { if (!cancelled) setSearchResults(results) })
      .catch(() => { if (!cancelled) push('Search failed.', 'error') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [ipc, searchMode, query, category, modifiedFilter, sortBy, sortDir, push])

  // Poll index status while indexing (and once on mount).
  useEffect(() => {
    if (!ipc) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = () => {
      ipc.files.indexStatus().then((s) => {
        if (cancelled) return
        setIndexStatus(s)
        if (s.indexing) timer = setTimeout(poll, 1500)
      }).catch(() => {})
    }
    poll()

    return () => { cancelled = true; clearTimeout(timer) }
  }, [ipc])

  // Load preview when a file is selected.
  useEffect(() => {
    if (!ipc || !selected || selected.isDir) { setPreview(null); return }
    let cancelled = false
    setPreviewLoading(true)
    ipc.files.readContent(selected.path)
      .then((result) => { if (!cancelled) setPreview(result) })
      .catch(() => { if (!cancelled) setPreview(null) })
      .finally(() => { if (!cancelled) setPreviewLoading(false) })
    return () => { cancelled = true }
  }, [ipc, selected])

  const visibleEntries = useMemo(() => {
    if (searchMode) return searchResults

    let entries = dirEntries
    if (category !== 'all') {
      entries = entries.filter((e) => e.isDir || categorizeExt(e.ext) === category)
    }
    const after = modifiedAfterMs(modifiedFilter)
    if (after) entries = entries.filter((e) => e.isDir || e.mtime >= after)

    const sorted = [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let cmp = 0
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'modified') cmp = a.mtime - b.mtime
      else cmp = a.size - b.size
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [searchMode, searchResults, dirEntries, category, modifiedFilter, sortBy, sortDir])

  const crumbs = homeDir && currentDir ? breadcrumbSegments(currentDir, homeDir) : []

  const handleOpenEntry = (entry: FileEntry) => {
    if (entry.isDir) {
      setRawQuery('')
      setQuery('')
      setCurrentDir(entry.path)
      setSelected(null)
    } else {
      setSelected(entry)
    }
  }

  const handleGoUp = () => {
    if (!currentDir || !homeDir) return
    if (currentDir.toLowerCase() === homeDir.toLowerCase()) return
    const parent = currentDir.slice(0, currentDir.lastIndexOf('\\'))
    setCurrentDir(parent.length >= homeDir.length ? parent : homeDir)
  }

  const handleOpenFile = async (entry: FileEntry) => {
    if (!ipc) return
    try {
      await ipc.files.open(entry.path)
    } catch {
      push('Could not open that file.', 'error')
    }
  }

  const handleReveal = async (entry: FileEntry) => {
    if (!ipc) return
    try {
      await ipc.files.reveal(entry.path)
    } catch {
      push('Could not reveal that file.', 'error')
    }
  }

  const handleReindex = async () => {
    if (!ipc) return
    try {
      await ipc.files.reindex()
      const s = await ipc.files.indexStatus()
      setIndexStatus(s)
    } catch {
      push('Could not start reindexing.', 'error')
    }
  }

  return (
    <div className="flex h-full">
      {/* List column */}
      <div className={`flex flex-col shrink-0 ${selected ? 'rule-r' : ''}`} style={{ width: selected ? 420 : '100%' }}>
        <div className="rule-b flex items-center justify-between px-6 py-4 shrink-0">
          <SectionHeader en="Files" ja="ファイル" romaji="fairu" />
          <button
            onClick={handleReindex}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-tint/5 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Rescan"
            title={indexStatus?.lastIndexedAt ? `Last indexed ${new Date(indexStatus.lastIndexedAt).toLocaleString()}` : 'Not indexed yet'}
          >
            <RefreshCw size={14} className={indexStatus?.indexing ? 'animate-spin-slow' : ''} />
          </button>
        </div>

        {indexStatus && (
          <div className="px-6 py-1.5 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {indexStatus.indexing
              ? `Indexing… ${indexStatus.filesIndexed.toLocaleString()} files scanned`
              : `${indexStatus.filesIndexed.toLocaleString()} files indexed`}
          </div>
        )}

        {/* Search bar */}
        <div className="px-4 pt-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            <Search size={13} style={{ color: 'var(--text-muted)' }} />
            <input
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              placeholder="Search files by name…"
              className="flex-1 bg-transparent text-xs focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Breadcrumbs (browse mode only) */}
        {!searchMode && (
          <div className="flex items-center gap-1 px-4 pt-2.5 text-[12px] overflow-x-auto" style={{ color: 'var(--text-muted)' }}>
            <button
              onClick={handleGoUp}
              disabled={!currentDir || !homeDir || currentDir.toLowerCase() === homeDir.toLowerCase()}
              className="w-5 h-5 rounded flex items-center justify-center hover:bg-tint/5 disabled:opacity-30 shrink-0"
              aria-label="Up one level"
            >
              <ArrowUp size={11} />
            </button>
            <button
              onClick={() => homeDir && setCurrentDir(homeDir)}
              className="flex items-center gap-1 shrink-0 hover:text-txt-secondary"
              style={{ color: crumbs.length === 0 ? 'var(--reigan-secondary)' : 'var(--text-muted)' }}
            >
              <Home size={11} /> Home
            </button>
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-1 shrink-0">
                <ChevronRight size={10} />
                <button
                  onClick={() => setCurrentDir(c.path)}
                  className="hover:text-txt-secondary whitespace-nowrap"
                  style={{ color: i === crumbs.length - 1 ? 'var(--reigan-secondary)' : 'var(--text-muted)' }}
                >
                  {c.label}
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="rule-b flex flex-col gap-2 px-4 pt-2.5 pb-2.5">
          <div className="flex gap-1 overflow-x-auto">
            {FILE_TYPE_CATEGORIES.map((c) => {
              const active = category === c.id
              return (
                <button
                  key={c.id}
                  onClick={() => setCategory(c.id)}
                  className="px-2.5 py-1 rounded-full text-[11px] whitespace-nowrap transition-colors shrink-0"
                  style={{
                    background: active ? 'color-mix(in srgb, var(--accent-secondary) 14%, transparent)' : 'transparent',
                    border: `1px solid ${active ? 'var(--reigan-secondary)' : 'var(--border)'}`,
                    color: active ? 'var(--reigan-secondary)' : 'var(--text-secondary)',
                  }}
                >
                  {c.en}
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={modifiedFilter}
              onChange={(e) => setModifiedFilter(e.target.value as ModifiedFilter)}
              className="text-[12px] rounded-md px-2 py-1 bg-transparent focus:outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              {MODIFIED_OPTIONS.map((o) => (
                <option key={o.key} value={o.key} style={{ background: 'var(--bg-elevated)' }}>{o.label}</option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="text-[12px] rounded-md px-2 py-1 bg-transparent focus:outline-none"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              <option value="name" style={{ background: 'var(--bg-elevated)' }}>Name</option>
              <option value="modified" style={{ background: 'var(--bg-elevated)' }}>Date modified</option>
              <option value="size" style={{ background: 'var(--bg-elevated)' }}>Size</option>
            </select>
            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              className="text-[12px] px-2 py-1 rounded-md hover:bg-tint/5"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </div>

        {/* Entry list */}
        <div className="flex-1 overflow-y-auto">
          {visibleEntries.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center px-6">
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {searchMode ? 'No matching files.' : 'This folder is empty.'}
              </p>
            </div>
          )}

          {visibleEntries.map((entry) => {
            const Icon = iconForEntry(entry)
            const active = selected?.path === entry.path
            return (
              <div
                key={entry.path}
                onClick={() => handleOpenEntry(entry)}
                onDoubleClick={() => { if (!entry.isDir) handleOpenFile(entry) }}
                className="rule-b group flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors"
                style={{
                  background: active ? 'var(--bg-elevated)' : 'transparent',
                  borderLeft: `2px solid ${active ? 'var(--reigan-secondary)' : 'transparent'}`,
                }}
              >
                <Icon size={15} style={{ color: entry.isDir ? 'var(--gold)' : 'var(--text-muted)' }} className="shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{entry.name}</p>
                  {searchMode && (
                    <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>{entry.dir}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!entry.isDir && (
                    <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>{formatBytes(entry.size)}</span>
                  )}
                  <span className="text-[11px] font-mono w-14 text-right" style={{ color: 'var(--text-muted)' }}>{formatDate(entry.mtime)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Preview column */}
      {selected && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="rule-b flex items-center gap-2 px-6 py-4 shrink-0">
            {(() => {
              const Icon = iconForEntry(selected)
              return <Icon size={15} style={{ color: 'var(--text-muted)' }} className="shrink-0" />
            })()}
            <h2 className="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: 'var(--text-primary)' }}>{selected.name}</h2>
            <button
              onClick={() => handleOpenFile(selected)}
              className="text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-tint/5 shrink-0 flex items-center gap-1"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <ExternalLink size={11} /> Open
            </button>
            <button
              onClick={() => handleReveal(selected)}
              className="text-[11px] px-2 py-1 rounded-md transition-colors hover:bg-tint/5 shrink-0 flex items-center gap-1"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
            >
              <FolderOpen size={11} /> Reveal
            </button>
          </div>

          <div className="rule-b px-6 py-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            <span>{selected.path}</span>
            <span>{formatBytes(selected.size)}</span>
            <span>{new Date(selected.mtime).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {previewLoading ? (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading preview…</span>
            ) : preview ? (
              <>
                <pre className="text-xs whitespace-pre-wrap leading-relaxed font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {preview.content}
                </pre>
                {preview.truncated && (
                  <p className="text-[11px] mt-3" style={{ color: 'var(--text-muted)' }}>
                    Preview truncated — open the file to view it in full.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No text preview available for this file type. Use Open to view it in its default app, or ask Shingan to summarize it in chat.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
