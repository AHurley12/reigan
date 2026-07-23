import React, { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { taskStatusLabel } from '../../../../shared/constants'
import { useSettingsStore } from '../../stores/settingsStore'
import type { Task, TaskPriority } from '../../../../shared/types'

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#6B6455',
  medium: '#5B7A99',
  high: '#C9A227',
  critical: '#E5484D',
}

interface Props {
  task: Task
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskCard({ task, onComplete, onDelete }: Props) {
  const isDone = task.status === 'done'
  const priorityColor = PRIORITY_COLORS[task.priority]
  const isOverdue = task.dueDate && task.dueDate < Date.now() && !isDone
  const [justCompleted, setJustCompleted] = useState(false)
  const japaneseLevel = useSettingsStore((s) => s.settings.japaneseLevel)

  const handleComplete = () => {
    setJustCompleted(true)
    onComplete(task.id)
  }

  return (
    <div
      className={`group relative overflow-hidden rounded-lg p-3 transition-all duration-fast animate-slide-up ${isDone ? 'opacity-60' : ''}`}
      style={{
        background: 'var(--bg-elevated)',
        border: `1px solid ${isOverdue ? 'rgba(229, 72, 77, 0.3)' : 'var(--border)'}`,
        borderLeft: `3px solid ${priorityColor}`,
      }}
    >
      {justCompleted && (
        <span
          className="absolute top-2 right-2 w-8 h-8 rounded-[3px] flex items-center justify-center animate-stamp pointer-events-none"
          style={{ background: 'var(--reigan-primary)', color: 'var(--text-primary)' }}
          aria-hidden="true"
        >
          <span style={{ fontFamily: 'var(--font-seal)', fontSize: 14 }}>完</span>
        </span>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm font-medium truncate ${isDone ? 'line-through' : ''}`}
            style={{ color: isDone ? 'var(--text-muted)' : 'var(--text-primary)' }}
          >
            {task.title}
          </p>
          {task.description && (
            <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
              {task.description}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isDone && (
            <button
              onClick={handleComplete}
              className="w-6 h-6 rounded flex items-center justify-center hover:bg-active/20 transition-colors"
              style={{ color: 'var(--active)' }}
              aria-label="Complete"
            >
              <Check size={12} />
            </button>
          )}
          <button
            onClick={() => onDelete(task.id)}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-critical/20 transition-colors"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span
          className="text-[10px] font-mono px-1.5 py-0.5 rounded"
          style={{ background: 'var(--bg-surface)', color: 'var(--text-kanji)' }}
        >
          {taskStatusLabel(task.status, japaneseLevel)}
        </span>
        <span
          className="text-[10px] capitalize"
          style={{ color: priorityColor }}
        >
          {task.priority}
        </span>
        {task.dueDate && (
          <span
            className="text-[10px] font-mono ml-auto"
            style={{ color: isOverdue ? 'var(--critical)' : 'var(--text-muted)' }}
          >
            {new Date(task.dueDate).toLocaleDateString()}
          </span>
        )}
      </div>
    </div>
  )
}
