import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CreateWorkspaceInput, User, Workspace } from '@/types/auth'

interface AuthState {
  accessToken: string | null
  user: User | null
  workspaces: Workspace[]
  isLoggedIn: boolean
  login: (email: string, password: string) => void
  logout: () => void
  createWorkspace: (data: CreateWorkspaceInput) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      user: null,
      workspaces: [],
      get isLoggedIn() {
        return !!get().accessToken
      },

      login: (email: string, _password: string) => {
        set({
          accessToken: 'placeholder-token',
          user: { id: '1', name: email.split('@')[0] ?? email, email },
        })
      },

      logout: () => {
        set({ accessToken: null, user: null, workspaces: [] })
      },

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
    }),
    {
      name: 'auth-store',
      partialize: state => ({
        accessToken: state.accessToken,
        user: state.user,
        workspaces: state.workspaces,
      }),
    },
  ),
)
