import { useEffect, useState } from 'react'
import { Brain, Check, Plus, RotateCcw, Trash2, X } from 'lucide-react'
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

// The kind only decides which heading a fact files under, but picking it is a
// two-second choice that stops everything the user types landing in one bucket
// — so it is a select rather than a hard-coded default.
const KIND_OPTIONS: Array<{ kind: ContextFactKind; label: string }> = [
  { kind: 'duty', label: 'Duty' },
  { kind: 'role', label: 'Role' },
  { kind: 'project', label: 'Project' },
  { kind: 'goal', label: 'Goal' },
  { kind: 'tendency', label: 'Pattern' },
]

export function ContextSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const set = useSettingsStore((s) => s.set)
  const push = useToastStore((s) => s.push)

  const [facts, setFacts] = useState<ContextFact[]>([])
  const [dismissedFacts, setDismissedFacts] = useState<ContextFact[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [newBody, setNewBody] = useState('')
  const [newKind, setNewKind] = useState<ContextFactKind>('duty')

  const load = async () => {
    try {
      const result = await window.reigan.listContextFacts()
      setFacts(result.active)
      setDismissedFacts(result.dismissed)
    } catch {
      push('Could not load what Shingan has learned', 'error')
    }
  }

  useEffect(() => {
    void (async () => {
      // Stats otherwise only recompute at launch, so a long-running app shows
      // as-of-launch numbers here. Refreshing first also means the derived
      // facts the refresh seeds or retracts are already settled by the time
      // the list below is read.
      try {
        await window.reigan.refreshContextStats()
      } catch {
        // Best effort. Stale numbers are worth far less than a blank tab.
      }
      await load()
    })()
  }, [])

  const startEdit = (fact: ContextFact) => {
    setEditingId(fact.id)
    setDraft(fact.body)
  }

  const saveEdit = async (id: string) => {
    if (!draft.trim()) return
    try {
      const updated = await window.reigan.editContextFact(id, draft.trim())
      setEditingId(null)
      await load()
      if (updated) {
        push('Correction saved — Shingan will treat this as ground truth', 'info')
      } else {
        push('That fact no longer exists — nothing was saved', 'error')
      }
    } catch {
      setEditingId(null)
      push('Could not save that correction', 'error')
    }
  }

  const dismiss = async (id: string) => {
    try {
      await window.reigan.dismissContextFact(id)
      await load()
    } catch {
      push('Could not remove that fact', 'error')
    }
  }

  const restore = async (fact: ContextFact) => {
    try {
      // Reactivate, don't re-author. Routing this through editContextFact
      // promoted the row to source 'user' at confidence 1, which for a
      // stat-derived fact meant its numbers could never update again.
      await window.reigan.restoreContextFact(fact.id)
      await load()
    } catch {
      push('Could not restore that fact', 'error')
    }
  }

  const addFact = async () => {
    const body = newBody.trim()
    if (!body) return
    try {
      const created = await window.reigan.addContextFact(newKind, body)
      if (created) {
        setNewBody('')
        await load()
        push('Added — Shingan will treat this as ground truth', 'info')
      } else {
        push('Could not add that', 'error')
      }
    } catch {
      push('Could not add that', 'error')
    }
  }

  const clearAll = async () => {
    try {
      await window.reigan.clearContextFacts()
      setConfirmClear(false)
      await load()
      push('Cleared everything Shingan had learned', 'info')
    } catch {
      push('Could not clear what Shingan has learned', 'error')
    }
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

      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Add what Shingan should know
        </h3>
        <div className="flex items-center gap-2">
          <select
            value={newKind}
            onChange={(e) => setNewKind(e.target.value as ContextFactKind)}
            aria-label="Kind of fact"
            className="text-[12px] rounded-md px-2 py-1.5 bg-transparent focus:outline-none"
            style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            {KIND_OPTIONS.map((o) => (
              <option key={o.kind} value={o.kind} style={{ background: 'var(--bg-elevated)' }}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={newBody}
            onChange={(e) => setNewBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addFact()
            }}
            placeholder="I work the evening shift at AWP."
            aria-label="What Shingan should know"
            className="flex-1 rounded-md px-2 py-1.5 bg-transparent text-sm outline-none"
            style={{ border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <button
            onClick={() => void addFact()}
            disabled={!newBody.trim()}
            title="Add"
            aria-label="Add fact"
            className="rounded-md p-1.5 disabled:opacity-40"
            style={{ border: '1px solid var(--border)' }}
          >
            <Plus size={14} style={{ color: 'var(--text-secondary)' }} />
          </button>
        </div>
      </div>

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
                      <button onClick={() => void saveEdit(fact.id)} title="Save" aria-label="Save correction">
                        <Check size={14} style={{ color: 'var(--reigan-primary)' }} />
                      </button>
                      <button onClick={() => setEditingId(null)} title="Cancel" aria-label="Cancel edit">
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
                      <button onClick={() => void dismiss(fact.id)} title="Remove" aria-label="Remove fact">
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

      {dismissedFacts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Removed
          </h3>

          {dismissedFacts.map((fact) => (
            <div
              key={fact.id}
              className="rounded-lg px-3 py-2 flex items-start gap-2"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', opacity: 0.7 }}
            >
              <span className="flex-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                {fact.body}
              </span>
              <button onClick={() => void restore(fact)} title="Restore" aria-label="Restore fact">
                <RotateCcw size={13} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Also gated on the Removed list: with every fact dismissed there was
          nothing active to show, the button vanished, and the only way to purge
          what Shingan still held disappeared with it. */}
      {(facts.length > 0 || dismissedFacts.length > 0) && (
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
