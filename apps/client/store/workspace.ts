import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import type { Workspace, WorkspacePlan } from '@/types'
import {
  Activity,
  Box,
  Building2,
  Cpu,
  Gauge,
  Globe,
  Shield,
  Thermometer,
} from 'lucide-react'

export const workspacesAtom = atomWithStorage<Workspace[]>('workspaces', [])

export const workspacePlansAtom = atom<WorkspacePlan[]>([])

export const clearWorkspacePlansAtom = atom(null, (_get, set) => {
  set(workspacePlansAtom, [])
})

export const sidebarCollapsedAtom = atomWithStorage('sidebar-collapsed', false)

export const workspaceIcons = [
  { id: 'building', label: 'Building', icon: Building2 },
  { id: 'box', label: 'Box', icon: Box },
  { id: 'cpu', label: 'CPU', icon: Cpu },
  { id: 'gauge', label: 'Gauge', icon: Gauge },
  { id: 'thermometer', label: 'Thermometer', icon: Thermometer },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'globe', label: 'Globe', icon: Globe },
  { id: 'shield', label: 'Shield', icon: Shield },
]

export const workspaceColors = [
  { id: 'blue', bg: 'bg-blue-500' },
  { id: 'violet', bg: 'bg-violet-500' },
  { id: 'emerald', bg: 'bg-emerald-500' },
  { id: 'amber', bg: 'bg-amber-500' },
  { id: 'rose', bg: 'bg-rose-500' },
  { id: 'cyan', bg: 'bg-cyan-500' },
]
