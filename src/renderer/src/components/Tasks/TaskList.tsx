import React from 'react'
import { TaskCard } from './TaskCard'
import type { Task } from '../../../../shared/types'

interface Props {
  tasks: Task[]
  onComplete: (id: string) => void
  onDelete: (id: string) => void
}

export function TaskList({ tasks, onComplete, onDelete }: Props) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
        <span className="text-2xl font-kanji" style={{ color: 'var(--text-kanji)', opacity: 0.3 }}>タスクなし</span>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No tasks yet. Ask Shingan to create one.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} onComplete={onComplete} onDelete={onDelete} />
      ))}
    </div>
  )
}
