import { atom } from 'jotai'
import type { TimeRange } from '@/lib/mock-readings'
import type { Dataset, FillStrategyConfig } from '@/lib/preprocessing'

export const TOTAL_WIZARD_STEPS = 7

export type FetchStatus = 'idle' | 'fetching' | 'done' | 'error'

export interface FetchState {
  status: FetchStatus
  progress: number
  error?: string
}

const EMPTY_DATASET: Dataset = { tags: [], rows: [] }

export const workspaceIdAtom = atom<string>('')
export const plantIdAtom = atom<string>('')
export const piServerIdAtom = atom<string>('')
export const selectedTagsAtom = atom<string[]>([])
export const timeRangeAtom = atom<TimeRange>('24h')
export const fetchStateAtom = atom<FetchState>({ status: 'idle', progress: 0 })
export const rawDatasetAtom = atom<Dataset>(EMPTY_DATASET)
export const fillStrategiesAtom = atom<Record<string, FillStrategyConfig>>({})
export const currentStepAtom = atom<number>(1)
export const highestUnlockedAtom = atom<number>(1)
export const selectedModelIdAtom = atom<string>('')
