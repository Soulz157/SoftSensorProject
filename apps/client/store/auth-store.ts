import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CreateWorkspaceInput, Workspace } from '@/types'

interface WorkspaceState {
  workspaces: Workspace[]
  createWorkspace: (data: CreateWorkspaceInput) => void
  clearWorkspaces: () => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    set => ({
      workspaces: [],

      createWorkspace: (data: CreateWorkspaceInput) => {
        const newWorkspace: Workspace = {
          id: crypto.randomUUID(),
          name: data.name,
          icon: data.icon,
          color: data.color,
          modelsCount: 0,
        }
        set(state => ({ workspaces: [...state.workspaces, newWorkspace] }))
      },

      clearWorkspaces: () => set({ workspaces: [] }),
    }),
    {
      name: 'workspace-store',
      partialize: state => ({ workspaces: state.workspaces }),
    },
  ),
)
