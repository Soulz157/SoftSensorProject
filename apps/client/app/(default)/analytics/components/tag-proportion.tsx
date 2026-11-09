import { tagSegments, totalTags } from '@/lib/data-intake'
import type { TagCounts, TagQuality } from '@/types/data-intake'
import { cn } from '@/lib/utils'
import { TAG_QUALITY_ICON } from './tag-quality-badge'

/** Neutral tokens only — `--chart-2` (green) and `--chart-3` (amber) read as
 *  status colours, which this panel must not claim. The icon and label carry
 *  the state; the swatch only has to be distinguishable. */
export const TAG_SWATCH: Record<TagQuality, string> = {
  good: 'bg-foreground/70',
  questionable: 'bg-foreground/40',
  bad: 'bg-chart-1',
  noReading: 'bg-muted-foreground/30',
  notLive: 'bg-muted-foreground/15',
}

export function TagProportion({ counts }: { counts: TagCounts }) {
  const total = totalTags(counts)
  const segments = tagSegments(counts)

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div>
        <h2 className="text-base font-medium">Live tag quality</h2>
        <p className="text-xs text-muted-foreground">
          Arrival quality of each tag&apos;s last fetch, not the PI flag
        </p>
      </div>

      {total === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No deployed model is fetching live input here yet.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={segments.map(s => `${s.label} ${s.count}`).join(', ')}
            className="flex h-2 overflow-hidden rounded-full bg-muted"
          >
            {segments.map(s => (
              <span
                key={s.quality}
                className={cn('h-full', TAG_SWATCH[s.quality])}
                style={{ width: `${s.pct}%` }}
              />
            ))}
          </div>

          <ul className="space-y-1.5">
            {segments.map(s => {
              const Icon = TAG_QUALITY_ICON[s.quality]
              return (
                <li
                  key={s.quality}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className={cn(
                        'size-2.5 rounded-sm',
                        TAG_SWATCH[s.quality],
                      )}
                    />
                    <Icon
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                    {s.label}
                  </span>
                  <span className="font-mono tabular-nums">
                    {s.count}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {s.pct.toFixed(0)}%
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            {total} distinct tags. Not live = schedule off or no fetch in the
            last three cadences.
          </p>
        </>
      )}
    </section>
  )
}
