import { useEffect, useState } from 'react'
import { Plus, Copy, Eye, EyeOff, Save, FileCode2 } from 'lucide-react'
import { useCapability } from '../useCapability'
import { AsyncPane } from '../shared/AsyncPane'
import { useToastStore } from '../../../stores/toastStore'

interface Snippet {
  id: string
  title: string
  description: string | null
  language: string | null
  body: string
  tags: string[]
  isSecret: boolean
  bodyRedacted: boolean
  useCount: number
}

interface Template {
  id: string
  name: string
  kind: string
  fields: Array<{ name: string; description: string; required: boolean; default?: string; isSecret?: boolean }>
}

/** A revealed secret hides itself again after this long. */
const REVEAL_TIMEOUT_MS = 15000

type Tab = 'snippets' | 'templates'

export function VaultView() {
  const search = useCapability<{ snippets: Snippet[] }>('vault.search')
  const create = useCapability<Snippet>('vault.create')
  const copy = useCapability<{ title: string }>('vault.copyToClipboard')
  const templates = useCapability<{ templates: Template[] }>('vault.listTemplates')
  const render = useCapability<{ body: string; missing: string[] }>('vault.renderTemplate')
  const toast = useToastStore((s) => s.push)

  const [tab, setTab] = useState<Tab>('snippets')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Snippet | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ title: '', body: '', tags: '', isSecret: false })

  const [activeTemplate, setActiveTemplate] = useState<Template | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    void search.run({ query: query || undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => void search.run({ query: query || undefined }), 220)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    if (tab === 'templates' && !templates.data) void templates.run({})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  const snippets = search.data?.snippets ?? []

  return (
    <div className="flex h-full gap-3">
      <div className="flex flex-col w-72 shrink-0 gap-2">
        <div className="flex rounded-sm overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          {(['snippets', 'templates'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 px-2 py-1.5 text-xs capitalize"
              style={{
                background: tab === t ? 'color-mix(in srgb, var(--accent-primary) 18%, transparent)' : 'transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-muted)',
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'snippets' ? (
          <>
            <div className="flex gap-1.5">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="flex-1 rounded-sm px-2 py-1.5 text-xs focus:outline-none"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              />
              <button
                onClick={() => {
                  setCreating(true)
                  setSelected(null)
                }}
                className="px-2 rounded-sm"
                style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                title="New snippet"
              >
                <Plus size={13} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-1">
              {snippets.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelected(s)
                    setCreating(false)
                  }}
                  className="flex flex-col items-start px-2 py-1.5 rounded-sm text-left"
                  style={{
                    border: `1px solid ${selected?.id === s.id ? 'var(--border-accent)' : 'var(--border)'}`,
                  }}
                >
                  <div className="flex items-center gap-1.5 w-full">
                    <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                      {s.title}
                    </span>
                    {s.isSecret && (
                      <span
                        className="ml-auto px-1 rounded-sm text-[10px] font-mono shrink-0"
                        style={{ color: 'var(--status-warning)', border: '1px solid var(--status-warning)' }}
                      >
                        secret
                      </span>
                    )}
                  </div>
                  {s.tags.length > 0 && (
                    <span className="font-mono text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      {s.tags.join(' · ')}
                    </span>
                  )}
                </button>
              ))}
              {!search.loading && snippets.length === 0 && (
                <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                  No snippets yet.
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 min-h-0 overflow-auto flex flex-col gap-1">
            {(templates.data?.templates ?? []).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTemplate(t)
                  setValues(Object.fromEntries(t.fields.map((f) => [f.name, f.default ?? ''])))
                  render.reset()
                }}
                className="flex items-center gap-1.5 px-2 py-1.5 rounded-sm text-left"
                style={{
                  border: `1px solid ${activeTemplate?.id === t.id ? 'var(--border-accent)' : 'var(--border)'}`,
                }}
              >
                <FileCode2 size={12} style={{ color: 'var(--text-muted)' }} />
                <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>
                  {t.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-auto">
        {tab === 'snippets' && creating && (
          <div className="flex flex-col gap-2 max-w-2xl">
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Title"
              className="rounded-sm px-2 py-1.5 text-sm focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <textarea
              value={draft.body}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              placeholder="Body"
              rows={12}
              spellCheck={false}
              className="rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none resize-y"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <input
              value={draft.tags}
              onChange={(e) => setDraft({ ...draft, tags: e.target.value })}
              placeholder="tags, comma separated"
              className="rounded-sm px-2 py-1.5 text-xs focus:outline-none"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            />
            <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={draft.isSecret}
                onChange={(e) => setDraft({ ...draft, isSecret: e.target.checked })}
              />
              Contains a credential — encrypt it, keep it out of the search index, and never show it to REIGAN
            </label>
            <button
              onClick={() =>
                void create
                  .run({
                    title: draft.title,
                    body: draft.body,
                    tags: draft.tags.split(',').map((t) => t.trim()).filter(Boolean),
                    isSecret: draft.isSecret,
                  })
                  .then((r) => {
                    if (r) {
                      toast(`Saved "${r.title}".`, 'success')
                      setCreating(false)
                      setDraft({ title: '', body: '', tags: '', isSecret: false })
                      void search.run({})
                    } else if (create.error) toast(create.error, 'error')
                  })
              }
              disabled={!draft.title.trim()}
              className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs"
              style={{ border: '1px solid var(--border-accent)', color: 'var(--text-primary)', opacity: draft.title ? 1 : 0.5 }}
            >
              <Save size={12} /> Save snippet
            </button>
          </div>
        )}

        {tab === 'snippets' && !creating && selected && <SnippetDetail snippet={selected} onCopy={() => {
          void copy.run({ id: selected.id }).then((r) => {
            if (r) toast(`Copied "${r.title}" to the clipboard.`, 'success')
            else if (copy.error) toast(copy.error, 'error')
          })
        }} />}

        {tab === 'snippets' && !creating && !selected && (
          <AsyncPane loading={search.loading} error={search.error} empty emptyTitle="Select a snippet" emptyHint="Or create one. Mark anything containing a credential as secret.">
            <div />
          </AsyncPane>
        )}

        {tab === 'templates' && activeTemplate && (
          <div className="flex flex-col gap-2 max-w-2xl">
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {activeTemplate.name}
            </span>
            {activeTemplate.fields.map((f) => (
              <label key={f.name} className="flex flex-col gap-0.5">
                <span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {f.name}
                  {f.required && '*'} — {f.description}
                </span>
                <input
                  type={f.isSecret ? 'password' : 'text'}
                  value={values[f.name] ?? ''}
                  onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                  className="rounded-sm px-2 py-1.5 text-xs font-mono focus:outline-none"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </label>
            ))}
            <button
              onClick={() => void render.run({ template: activeTemplate.id, values })}
              className="self-start px-3 py-1.5 rounded-sm text-xs"
              style={{ border: '1px solid var(--border-accent)', color: 'var(--text-primary)' }}
            >
              Render
            </button>

            {render.data && (
              <>
                {render.data.missing.length > 0 && (
                  <span className="font-mono text-xs" style={{ color: 'var(--status-warning)' }}>
                    Still missing: {render.data.missing.join(', ')}
                  </span>
                )}
                <pre
                  className="font-mono text-xs whitespace-pre-wrap p-2 rounded-sm overflow-x-auto"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  {render.data.body}
                </pre>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(render.data!.body)
                    toast('Rendered config copied to the clipboard.', 'success')
                  }}
                  className="self-start flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-xs"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
                >
                  <Copy size={12} /> Copy
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SnippetDetail({ snippet, onCopy }: { snippet: Snippet; onCopy: () => void }) {
  const [revealed, setRevealed] = useState(false)

  // Auto-hides so a revealed credential does not sit on screen indefinitely.
  useEffect(() => {
    if (!revealed) return
    const timer = setTimeout(() => setRevealed(false), REVEAL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [revealed])

  return (
    <div className="flex flex-col gap-2 max-w-3xl">
      <div className="flex items-center gap-2">
        <span className="text-sm" style={{ color: 'var(--text-primary)' }}>
          {snippet.title}
        </span>
        {snippet.isSecret && (
          <button
            onClick={() => setRevealed((r) => !r)}
            className="flex items-center gap-1 px-2 py-1 rounded-sm text-xs"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {revealed ? <EyeOff size={11} /> : <Eye size={11} />}
            {revealed ? 'Hide' : 'Reveal for 15s'}
          </button>
        )}
        <button
          onClick={onCopy}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-xs"
          style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <Copy size={12} /> Copy
        </button>
      </div>

      {snippet.description && (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {snippet.description}
        </span>
      )}

      <pre
        className="font-mono text-xs whitespace-pre-wrap p-2 rounded-sm overflow-x-auto"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
      >
        {/* A secret body never reaches this component in the clear: the
            renderer receives the redaction notice, and Copy routes through
            main. Reveal therefore explains that rather than pretending. */}
        {snippet.isSecret && !revealed
          ? '•'.repeat(48)
          : snippet.isSecret && revealed
            ? 'This value is held in the main process only. Use Copy to put it on the clipboard — it is never sent to the window, so it cannot be shown here.'
            : snippet.body}
      </pre>
    </div>
  )
}
