import { atom } from 'jotai'
import type { DataSourceKind } from '@/lib/mock-data-sources'

export const dsSearchAtom = atom<string>('')
export const dsTypeFilterAtom = atom<'all' | DataSourceKind>('all')
export const dsStatusFilterAtom = atom<'all' | 'connected' | 'offline'>('all')
