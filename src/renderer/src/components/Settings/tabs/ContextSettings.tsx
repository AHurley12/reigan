import { useEffect, useState } from 'react'
import { Brain, Check, Trash2, X } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useToastStore } from '../../../stores/toastStore'
import { SettingRow } from '../controls/SettingRow'
import { Button } from '../../shared/Button'
import type { ContextFact, ContextFactKind } from '../../../../../shared/types'

const GROUPS: Array<{ heading: string; kinds: ContextFactKind[] }> = [
  { heading: 'Duties & roles', kinds: ['role', 'duty'] },
  { heading: 'Goals & projects', kinds: ['project', 'goal'] },
  { heading: 'Patterns', kinds: ['tendency'] },
]

export function ContextSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const push = useToastStore((s) => s.push)

  const [facts, setFacts] = useState<ContextFact[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)

  const load = async () => {
    const result = await window.reigan.listContextFacts()
    setFacts(result.active)
  }

  useEffect(() => {
    void load()
  }, [])

  const startEdit = (fact: ContextFact) => {
    setEditingId(fact.id)
    setDraft(fact.body)
  }

  const saveEdit = async (id: string) => {
    if (!draft.trim()) return
    await window.reigan.editContextFact(id, draft.trim())
    setEditingId(null)
    await load()
    push('Correction saved — Shingan will treat this as ground truth', 'info')
  }

  const dismiss = async (id: string) => {
    await window.reigan.dismissContextFact(id)
    await load()
  }

  const clearAll = async () => {
    await window.reigan.clearContextFacts()
    setConfirmClear(false)
    await load()
    push('Cleared everything Shingan had learned', 'info')
  }

  return (
    <div className="space-y-6">
      <SettingRow
        label="Keep learning"
        labelJa="学習"
        description="Shingan builds up what it knows about your duties, projects, and habits from your conversations and your actual task data. Pausing keeps what it already knows but stops it adding more."
      >
        <Button
          size="sm"
          variant={settings.contextLearningPaused ? 'ghost' : 'primary'}
          onClick={() => set('contextLearningPaused', !settings.contextLearningPaused)}
        >
          {settings.contextLearningPaused ? 'Paused' : 'Active'}
        </Button>
      </SettingRow>

      {facts.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg px-3 py-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <Brain size={14} style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Nothing learned yet. Facts appear here as you talk to Shingan and as your task data accumulates.
          </span>
        </div>
      ) : (
        GROUPS.map((group) => {
          const inGroup = facts.filter((f) => group.kinds.includes(f.kind))
          if (inGroup.length === 0) return null

          return (
            <div key={group.heading} className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
                {group.heading}
              </h3>

              {inGroup.map((fact) => (
                <div
                  key={fact.id}
                  className="rounded-lg px-3 py-2 flex items-start gap-2"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  {editingId === fact.id ? (
                    <>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveEdit(fact.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        className="flex-1 bg-transparent text-sm outline-none"
                        style={{ color: 'var(--text-primary)' }}
                      />
                      <button onClick={() => void saveEdit(fact.id)} title="Save">
                        <Check size={14} style={{ color: 'var(--reigan-primary)' }} />
                      </button>
                      <button onClick={() => setEditingId(null)} title="Cancel">
                        <X size={14} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="flex-1 text-left text-sm"
                        style={{ color: 'var(--text-primary)' }}
                        onClick={() => startEdit(fact)}
                        title="Click to correct"
                      >
                        {fact.body}
                      </button>
                      {fact.source === 'user' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--accent-primary) 15%, transparent)', color: 'var(--text-secondary)' }}>
                          yours
                        </span>
                      )}
                      <button onClick={() => void dismiss(fact.id)} title="Remove">
                        <Trash2 size={13} style={{ color: 'var(--text-muted)' }} />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )
        })
      )}

      {facts.length > 0 && (
        confirmClear ? (
          <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-hover)' }}>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              This deletes everything Shingan has learned about you, including your own corrections. It starts over from nothing.
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void clearAll()}>Clear everything</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>Clear everything</Button>
        )
      )}
    </div>
  )
}
