import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Loader2,
  Undo2,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { STATUS_LABEL } from '@/lib/backfill-history'
import type { WriteBackStatus } from '@/services/model-backfill'

const ICON: Record<WriteBackStatus, LucideIcon> = {
  PENDING: CircleDashed,
  WRITING: Loader2,
  SUCCEEDED: CircleCheck,
  PARTIAL: CircleAlert,
  FAILED: CircleX,
  ROLLED_BACK: Undo2,
}

/**
 * MODEL-SERVE-032. Status as icon + words in neutral tokens. Red and amber
 * belong to workspace / plant status, so a failed write is told apart by its
 * label and icon, not by a colour.
 */
export function WriteStatusBadge({ status }: { status: WriteBackStatus }) {
  const Icon = ICON[status]
  return (
    <Badge variant="outline" className="gap-1 font-normal">
      <Icon
        className={`h-3 w-3 ${status === 'WRITING' ? 'animate-spin' : ''}`}
        aria-hidden
      />
      {STATUS_LABEL[status]}
    </Badge>
  )
}
