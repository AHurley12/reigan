import React from 'react'
import { Check, Trash2 } from 'lucide-react'
import type { Task, TaskPriority, TaskStatus } from '../../../../shared/types'

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: '#4A5568',
  medium: '#3B82F6',
  high: '#F59E0B',
  critical: '#EF4444',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: '待機',
  active: '進行中',
  review: '確認',
  done: '完了',
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

  return (
    <div
      className={`group rounded-lg p-3 transition-all duration-fast animate-slide-up ${isDone ? 'opacity-60' : ''}`}
      style={{
        background: 'var(--bg-elevated)',
        border: `1px solid ${isOverdue ? 'rgba(239, 68, 68, 0.3)' : 'var(--border)'}`,
        borderLeft: `3px solid ${priorityColor}`,
      }}
    >
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
              onClick={() => onComplete(task.id)}
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
          {STATUS_LABELS[task.status]}
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
