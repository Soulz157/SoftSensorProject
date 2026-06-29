import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { BINARY_STATUS_META, type BinaryStatus } from '@/lib/overview-status'

interface ZoneHoverCardProps {
  name: string
  counts: Record<BinaryStatus, number>
  deviceCount: number
}

// Per-zone status breakdown shown inside the plant map's Radix tooltip — mirrors
// the workspace overview hover card (overview-map.tsx) for visual parity.
export function ZoneHoverCard({
  name,
  counts,
  deviceCount,
}: ZoneHoverCardProps) {
  return (
    <div className="w-44">
      <p className="mb-2.5 truncate text-[11px] font-semibold leading-tight text-foreground">
        {name}
      </p>

      <div className="space-y-1.5">
        {(
          Object.entries(BINARY_STATUS_META) as [
            BinaryStatus,
            { label: string; color: string },
          ][]
        ).map(([key, meta]) => (
          <div key={key} className="flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: meta.color }}
            />
            <span className="flex-1 text-[10px] text-muted-foreground">
              {meta.label}
            </span>
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] font-semibold tabular-nums"
              style={{ borderColor: `${meta.color}50`, color: meta.color }}
            >
              {counts[key]}
            </Badge>
          </div>
        ))}
      </div>

      <Separator className="my-2 opacity-20" />
      <p className="text-[10px] text-muted-foreground">
        {deviceCount} device{deviceCount === 1 ? '' : 's'} · double-click to
        open
      </p>
    </div>
  )
}
