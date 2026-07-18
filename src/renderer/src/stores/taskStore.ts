import { create } from 'zustand'
import type { Task, TaskStatus } from '../../../shared/types'

type ViewMode = 'list' | 'kanban'

interface TaskStore {
  tasks: Task[]
  viewMode: ViewMode
  filterStatus: TaskStatus | null
  setTasks: (tasks: Task[]) => void
  addTask: (task: Task) => void
  updateTask: (id: string, updates: Partial<Task>) => void
  removeTask: (id: string) => void
  setViewMode: (mode: ViewMode) => void
  setFilterStatus: (status: TaskStatus | null) => void
}

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  viewMode: 'list',
  filterStatus: null,

  setTasks: (tasks) => set({ tasks }),
  addTask: (task) => set((s) => ({ tasks: [task, ...s.tasks] })),
  updateTask: (id, updates) =>
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)) })),
  removeTask: (id) => set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) })),
  setViewMode: (mode) => set({ viewMode: mode }),
  setFilterStatus: (status) => set({ filterStatus: status }),
}))
