import React, { useEffect, useState } from 'react'
import { LayoutList, Columns, Plus } from 'lucide-react'
import { TaskList } from './TaskList'
import { TaskCard } from './TaskCard'
import { SectionHeader } from '../shared/SectionHeader'
import { Button } from '../shared/Button'
import { useTaskStore } from '../../stores/taskStore'
import { useIPC } from '../../hooks/useIPC'
import { TASK_COLUMNS } from '../../../../shared/constants'
import type { TaskStatus } from '../../../../shared/types'

export function TaskPanel() {
  const { tasks, viewMode, filterStatus, setTasks, addTask, updateTask, removeTask, setViewMode, setFilterStatus } = useTaskStore()
  const ipc = useIPC()
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  useEffect(() => {
    ipc?.listTasks().then(setTasks).catch(console.error)
  }, [])

  const handleComplete = async (id: string) => {
    const updated = await ipc?.updateTask(id, { status: 'done', completedAt: Date.now() })
    if (updated) updateTask(id, updated)
  }

  const handleDelete = async (id: string) => {
    await ipc?.deleteTask(id)
    removeTask(id)
  }

  const handleCreate = async () => {
    if (!newTaskTitle.trim()) return
    setIsCreating(true)
    try {
      const task = await ipc?.createTask({ title: newTaskTitle.trim() })
      if (task) addTask(task)
      setNewTaskTitle('')
    } finally {
      setIsCreating(false)
    }
  }

  const filtered = filterStatus ? tasks.filter((t) => t.status === filterStatus) : tasks

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <SectionHeader en="Tasks" ja="タスク" romaji="tasuku" />

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'text-txt-primary bg-white/10' : 'text-txt-muted hover:text-txt-secondary'}`}
          >
            <LayoutList size={16} />
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`p-1.5 rounded transition-colors ${viewMode === 'kanban' ? 'text-txt-primary bg-white/10' : 'text-txt-muted hover:text-txt-secondary'}`}
          >
            <Columns size={16} />
          </button>
        </div>
      </div>

      {/* Quick create */}
      <div className="px-6 py-3 flex gap-2 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <input
          value={newTaskTitle}
          onChange={(e) => setNewTaskTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          placeholder="Quick add task..."
          className="flex-1 bg-elevated rounded-md px-3 py-1.5 text-sm
            placeholder:text-txt-muted text-txt-primary
            border border-[var(--border)] focus:border-[var(--border-accent)] focus:outline-none
            transition-colors duration-fast"
        />
        <Button size="sm" variant="ghost" onClick={handleCreate} disabled={isCreating}>
          <Plus size={14} />
        </Button>
      </div>

      {/* Filter tabs */}
      <div className="px-6 py-2 flex gap-1 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setFilterStatus(null)}
          className={`px-2 py-1 rounded text-xs transition-colors ${filterStatus === null ? 'bg-white/10 text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'}`}
        >
          All
        </button>
        {TASK_COLUMNS.map((col) => (
          <button
            key={col.id}
            onClick={() => setFilterStatus(col.id as TaskStatus)}
            className={`px-2 py-1 rounded text-xs transition-colors ${filterStatus === col.id ? 'bg-white/10 text-txt-primary' : 'text-txt-muted hover:text-txt-secondary'}`}
          >
            {col.en}
          </button>
        ))}
      </div>

      {/* Task content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {viewMode === 'list' ? (
          <TaskList tasks={filtered} onComplete={handleComplete} onDelete={handleDelete} />
        ) : (
          <div className="grid grid-cols-4 gap-3 h-full">
            {TASK_COLUMNS.map((col) => {
              const colTasks = tasks.filter((t) => t.status === col.id)
              return (
                <div key={col.id} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between mb-1">
                    <SectionHeader en={col.en} ja={col.ja} romaji={col.romaji} />
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {colTasks.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 overflow-y-auto">
                    {colTasks.map((task) => (
                      <TaskCard key={task.id} task={task} onComplete={handleComplete} onDelete={handleDelete} />
                    ))}
                    {colTasks.length === 0 && (
                      <div className="text-center py-6 text-[10px] font-kanji"
                        style={{ color: 'var(--text-kanji)', opacity: 0.4 }}>
                        {col.ja}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
