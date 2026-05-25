import { atomWithStorage } from 'jotai/utils'
import type { Workspace } from '@/types'

export const workspacesAtom = atomWithStorage<Workspace[]>('workspaces', [])

export const sidebarCollapsedAtom = atomWithStorage('sidebar-collapsed', false)
