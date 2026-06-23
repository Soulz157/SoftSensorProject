import {
  AlertTriangle,
  Cpu,
  Gauge,
  Pencil,
  Plus,
  Settings2,
  Thermometer,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { NodeData } from '@/services/canvas'
import type { NodeStatus } from '@/store/status-colors'
import type { WorkspaceAction, WorkspaceLog } from '@/types'

export type NodeType = NodeData['type']
export type ModelStatus = 'active' | 'warning' | 'error' | 'stopped'

export function formatRelativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

export function getNodeIcon(type: NodeType) {
  switch (type) {
    case 'machine':
      return <Cpu className="h-4 w-4" />
    case 'sensor':
      return <Thermometer className="h-4 w-4" />
    case 'controller':
      return <Gauge className="h-4 w-4" />
  }
}

export function statusColors(status: NodeStatus | ModelStatus) {
  switch (status) {
    case 'normal':
    case 'active':
      return {
        text: 'text-emerald-500',
        bg: 'bg-emerald-500/10',
        dot: 'bg-emerald-500',
      }
    case 'warning':
      return {
        text: 'text-amber-500',
        bg: 'bg-amber-500/10',
        dot: 'bg-amber-500',
      }
    case 'alarm':
    case 'error':
      return { text: 'text-red-500', bg: 'bg-red-500/10', dot: 'bg-red-500' }
    default:
      return { text: 'text-zinc-400', bg: 'bg-zinc-500/10', dot: 'bg-zinc-400' }
  }
}

export function actorName(log: WorkspaceLog): string {
  const { firstName, lastName, email } = log.user
  if (firstName || lastName)
    return `${firstName ?? ''} ${lastName ?? ''}`.trim()
  return email
}

export function actionLabel(action: WorkspaceAction): string {
  switch (action) {
    case 'CREATED':
      return 'Workspace created'
    case 'UPDATED':
      return 'Workspace updated'
    case 'DELETED':
      return 'Workspace deleted'
    case 'MODEL_ADDED':
      return 'Model added'
    case 'MODEL_REMOVED':
      return 'Model removed'
    case 'MODEL_UPDATED':
      return 'Model updated'
    default:
      return action
  }
}

const DANGER_ACTIONS: WorkspaceAction[] = ['DELETED', 'MODEL_REMOVED']

export function ActionIcon({ action }: { action: WorkspaceAction }) {
  const danger = DANGER_ACTIONS.includes(action)
  const cls = danger
    ? 'bg-red-500/10 text-red-500'
    : 'bg-primary/10 text-primary'
  const Icon =
    action === 'DELETED' || action === 'MODEL_REMOVED'
      ? Trash2
      : action === 'MODEL_ADDED'
        ? Plus
        : action === 'MODEL_UPDATED'
          ? Pencil
          : action === 'UPDATED'
            ? Settings2
            : action === 'CREATED'
              ? Plus
              : AlertTriangle
  return (
    <div className={cn('rounded-md p-2', cls)}>
      <Icon className="h-4 w-4" />
    </div>
  )
}
