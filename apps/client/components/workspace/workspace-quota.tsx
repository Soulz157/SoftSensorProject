import type { ReactNode } from 'react'
import { BrainCircuit, User, Users } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatLimit,
  ownerDisplayName,
  quotaPercent,
  quotaSourceLabel,
} from '@/lib/workspace-limits'
import type { WorkspaceDetail, WorkspaceQuotaItem } from '@/types'

interface WorkspaceQuotaProps {
  quota: WorkspaceDetail['quota']
  owner: WorkspaceDetail['owner']
  loading?: boolean
  /** Rows shown between the owner line and the quota rows, e.g. a plain
   *  count (Equipment) that sits in the same list as Models and Members. */
  children?: ReactNode
}

/** A plain count with no cap, laid out like a quota row's first line. */
export function CountRow({
  label,
  icon: Icon,
  value,
}: {
  label: string
  icon: typeof Users
  value: number
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
        {label}
      </span>
      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
        {value}
      </span>
    </div>
  )
}

function QuotaRow({
  label,
  icon: Icon,
  item,
}: {
  label: string
  icon: typeof Users
  item: WorkspaceQuotaItem
}) {
  const capped = item.limit !== null
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden="true" className="h-3.5 w-3.5" />
          {label}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {formatLimit(item.current, item.limit)}
        </span>
      </div>
      {capped && (
        <Progress
          value={quotaPercent(item)}
          aria-label={`${label} used`}
          className="h-1.5"
        />
      )}
      <p className="text-xs text-muted-foreground">
        {item.full
          ? `${item.over ? 'Over' : 'At'} the limit · ${quotaSourceLabel(item.source)}`
          : quotaSourceLabel(item.source)}
      </p>
    </div>
  )
}

/**
 * MODEL-SERVE-040. What this workspace may hold — models and members against
 * the cap that applies (an admin override, else the owner's subscription) —
 * and who owns it. Shared by the Overview detail panel and Workspace Settings
 * so the two never word a quota differently. "At the limit" is plain text, not
 * red/amber: those colours are reserved for workspace and plant status.
 */
export function WorkspaceQuota({
  quota,
  owner,
  loading,
  children,
}: WorkspaceQuotaProps) {
  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <User aria-hidden="true" className="h-3.5 w-3.5" />
        Owner ·{' '}
        <span className="text-foreground">{ownerDisplayName(owner)}</span>
      </p>
      {children}
      {quota ? (
        <>
          <QuotaRow label="Models" icon={BrainCircuit} item={quota.models} />
          <QuotaRow label="Members" icon={Users} item={quota.members} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Quota unavailable.</p>
      )}
    </div>
  )
}
