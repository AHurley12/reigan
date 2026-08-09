import type { PerfSample, PerfStaticInfo } from '../../../../shared/types'

export interface PerfHistory {
  cpu: number[]
  memory: number[]
  gpu: number[][] // one history array per GPU controller, indexed to match sample.gpu
  diskRead: number[]
  diskWrite: number[]
  networkRx: number[]
  networkTx: number[]
}

export interface PerformanceViewProps {
  sample: PerfSample | null
  history: PerfHistory
  staticInfo: PerfStaticInfo | null
}
