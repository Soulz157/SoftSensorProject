import { Badge } from '@/components/ui/badge'

/**
 * MODEL-SERVE-018. Marks the pinned target (y) row in the drift and PSI
 * tables. Neutral on purpose: red/amber are reserved for status, and the
 * row's own status pill already carries the verdict.
 */
export function TargetBadge() {
  return (
    <Badge variant="outline" className="h-4 px-1.5 font-sans text-[10px]">
      Target (y)
    </Badge>
  )
}
