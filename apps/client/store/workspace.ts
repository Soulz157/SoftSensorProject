import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { CreateWorkspaceInput, Workspace } from '@/types'

export const workspacesAtom = atomWithStorage<Workspace[]>('workspaces', [])

export const sidebarCollapsedAtom = atomWithStorage('sidebar-collapsed', false)

export const createWorkspaceAtom = atom(
  null,
  (get, set, data: CreateWorkspaceInput) => {
    const newWorkspace: Workspace = {
      id: crypto.randomUUID(),
      name: data.name,
      icon: data.icon,
      color: data.color,
      modelsCount: 0,
    }
    set(workspacesAtom, [...get(workspacesAtom), newWorkspace])
  },
)

export const clearWorkspacesAtom = atom(null, (_get, set) => {
  set(workspacesAtom, [])
})
