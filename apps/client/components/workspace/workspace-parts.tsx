import { TriangleAlert } from 'lucide-react'
import { workspaceColors, workspaceIcons } from '@/store/workspace'
import { BINARY_STATUS_META } from '@/lib/overview-status'
import type { ListStatus } from '@/lib/workspace-list'
import { cn } from '@/lib/utils'

export const ATTENTION_TEXT = BINARY_STATUS_META.abnormal.text

export function WorkspaceIconTile({
  iconId,
  colorId,
  className,
}: {
  iconId?: string
  colorId?: string
  className?: string
}) {
  const Icon = workspaceIcons.find(i => i.id === (iconId ?? 'box'))?.icon
  const bg = workspaceColors.find(c => c.id === colorId)?.bg ?? 'bg-slate-500'
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-lg text-white',
        bg,
        className,
      )}
    >
      {Icon ? (
        <Icon className="size-5" />
      ) : (
        <span className="text-sm font-semibold">
          {(iconId ?? '?').charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}

export function StatusPill({ status }: { status: ListStatus }) {
  const meta =
    status === 'unknown'
      ? { dot: 'bg-muted-foreground/40', label: 'Checking' }
      : BINARY_STATUS_META[status]
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 text-xs font-medium',
        status === 'unknown' && 'text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'size-2 rounded-full',
          meta.dot,
          status === 'abnormal' &&
            'ring-4 ring-red-500/20 motion-safe:animate-pulse',
        )}
      />
      {meta.label}
    </span>
  )
}

export function CountValue({
  value,
  label,
}: {
  value: number | null | undefined
  label: string
}) {
  const known = typeof value === 'number'
  return (
    <span
      className={cn(
        'font-mono text-sm tabular-nums',
        known ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <span aria-hidden>{known ? value : '—'}</span>
      <span className="sr-only">
        {known ? `${value} ${label}` : `${label} unknown`}
      </span>
    </span>
  )
}

export function AttentionNote({ count }: { count: number | null }) {
  if (count === null || count <= 0) return null
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium',
        ATTENTION_TEXT,
      )}
    >
      <TriangleAlert className="size-3.5" aria-hidden />
      {count} {count === 1 ? 'model needs' : 'models need'} attention
    </span>
  )
}
