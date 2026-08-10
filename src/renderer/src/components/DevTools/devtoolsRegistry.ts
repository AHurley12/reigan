import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { FolderGit2, Github, FolderCog, TerminalSquare, Radio, KeyRound, type LucideIcon } from 'lucide-react'

export interface DevToolsSection {
  id: string
  labelEn: string
  labelJa: string
  icon: LucideIcon
  component: LazyExoticComponent<ComponentType>
  /** Shown in the empty state of a section that is not finished. */
  unavailable?: string
}

/**
 * Sub-sections of the Dev Tools tab.
 *
 * Same shape as SETTINGS_TABS — build the view, add one entry, done.
 *
 * Every component is `lazy`. The renderer already ships a single 2.5MB chunk,
 * and statically importing six more views into it would spend the whole
 * cold-start budget before any Dev Tools code runs.
 */
export const DEVTOOLS_SECTIONS: DevToolsSection[] = [
  {
    id: 'projects',
    labelEn: 'Projects',
    labelJa: '計画',
    icon: FolderGit2,
    component: lazy(() => import('./views/ProjectsView').then((m) => ({ default: m.ProjectsView }))),
  },
  {
    id: 'ports',
    labelEn: 'Localhost',
    labelJa: '接続',
    icon: Radio,
    component: lazy(() => import('./views/PortsView').then((m) => ({ default: m.PortsView }))),
  },
  {
    id: 'shell',
    labelEn: 'Shell',
    labelJa: '端末',
    icon: TerminalSquare,
    component: lazy(() => import('./views/ShellView').then((m) => ({ default: m.ShellView }))),
  },
  {
    id: 'organizer',
    labelEn: 'Organizer',
    labelJa: '整理',
    icon: FolderCog,
    component: lazy(() => import('./views/OrganizerView').then((m) => ({ default: m.OrganizerView }))),
  },
  {
    id: 'vault',
    labelEn: 'Vault',
    labelJa: '金庫',
    icon: KeyRound,
    component: lazy(() => import('./views/VaultView').then((m) => ({ default: m.VaultView }))),
  },
  {
    id: 'github',
    labelEn: 'GitHub',
    labelJa: '倉庫',
    icon: Github,
    component: lazy(() => import('./views/GitHubView').then((m) => ({ default: m.GitHubView }))),
  },
]
