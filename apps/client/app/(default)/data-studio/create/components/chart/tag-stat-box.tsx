// components/tag-stat-box.tsx
import type { TagStatRow } from '@/hooks/use-tag-stats'
import { StatTile } from '../stat-tile'

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

interface Props {
  row: TagStatRow
}

export function TagStatBox({ row }: Props) {
  const stats = [
    { label: 'Mean', value: fmt(row.mean) },
    { label: 'Median', value: fmt(row.median) },
    { label: 'Mode', value: fmt(row.mode) },
    { label: 'SD', value: `±${fmt(row.std)}` },
  ] as const

  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: row.fill }}
        />
        <span className="font-mono text-sm text-foreground">{row.tag}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {stats.map(s => (
          <StatTile
            key={s.label}
            surface="bare"
            valueSize="sm"
            label={s.label}
            value={s.value}
          />
        ))}
      </div>
    </div>
  )
}
