import type {
  ColumnRangeDrift,
  InputTrendSeries,
} from '@/services/model-monitoring'
import { driftStats } from '@/lib/input-drift'

interface Props {
  col: ColumnRangeDrift
  series: InputTrendSeries | undefined
}

/** MODEL-SERVE-036. The figures behind the badge, in engineering units. */
export function InputDriftStats({ col, series }: Props) {
  const stats = driftStats(col, series)
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-4">
      {stats.map(s => (
        <div key={s.label} className="bg-card px-3 py-2">
          <dt className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {s.label}
          </dt>
          <dd className="mt-0.5 font-mono text-sm text-foreground tabular-nums">
            {s.value}
          </dd>
          {s.hint && (
            <dd className="text-[10px] text-muted-foreground">{s.hint}</dd>
          )}
        </div>
      ))}
    </dl>
  )
}
