import type { ComponentType } from 'react'
import { Activity, ListTree, HardDrive, Wifi, type LucideIcon } from 'lucide-react'
import { OverviewView } from './views/OverviewView'
import { ProcessesView } from './views/ProcessesView'
import { DiskView } from './views/DiskView'
import { NetworkView } from './views/NetworkView'
import type { PerformanceViewProps } from './types'

export interface PerformanceTab {
  id: string
  labelEn: string
  labelJa: string
  icon: LucideIcon
  component: ComponentType<PerformanceViewProps>
}

// To add a new performance section: build the view component in ./views, then add
// one entry here. That's the whole registration step.
export const PERFORMANCE_TABS: PerformanceTab[] = [
  { id: 'overview', labelEn: 'Overview', labelJa: '概要', icon: Activity, component: OverviewView },
  { id: 'processes', labelEn: 'Processes', labelJa: 'プロセス', icon: ListTree, component: ProcessesView },
  { id: 'disk', labelEn: 'Disk', labelJa: 'ディスク', icon: HardDrive, component: DiskView },
  { id: 'network', labelEn: 'Network', labelJa: 'ネットワーク', icon: Wifi, component: NetworkView },
]
