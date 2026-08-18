'use client'

import { useMemo } from 'react'
import { CircleAlert, CircleHelp, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveTagMeta } from '@/lib/mock-readings'
import {
  datasetQuality,
  qualityByTag,
  type TagQuality,
} from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'
import { StatTile } from './stat-tile'

interface Props {
  dataset: Dataset
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

/** Stacked Good / Suspect / Missing bar for one tag (or the whole dataset). */
function QualityBar({
  q,
}: {
  q: Pick<TagQuality, 'missingPct' | 'suspectPct'>
}) {
  const goodPct = Math.max(0, 100 - q.missingPct - q.suspectPct)
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
      <span
        className="h-full bg-emerald-500/70"
        style={{ width: `${goodPct}%` }}
      />
      <span
        className="h-full bg-amber-500"
        style={{ width: `${q.suspectPct}%` }}
      />
      <span
        className="h-full bg-destructive"
        style={{ width: `${q.missingPct}%` }}
      />
    </div>
  )
}

/**
 * Pre-cleansing data-quality overview. Surfaces Missing (Bad) and Suspect
 * (Questionable) counts + percentages per tag and dataset-wide, so the user
 * understands data gaps before the Processing step. Pure display — all numbers
 * come from `lib/data-quality`.
 */
export function DataQualityPanel({ dataset }: Props) {
  const overall = useMemo(() => datasetQuality(dataset), [dataset])
  const byTag = useMemo(() => qualityByTag(dataset), [dataset])

  if (dataset.tags.length === 0 || overall.total === 0) return null

  return (
    <div className="space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium text-foreground">
          Data Quality Overview
        </h2>
      </div>

      {/* Dataset headline */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          surface="muted"
          valueSize="md"
          label="Good"
          value={fmtPct(100 - overall.missingPct - overall.suspectPct)}
          sub={`${overall.good} cells`}
          toneClassName="text-emerald-600 dark:text-emerald-400"
        />
        <StatTile
          surface="muted"
          valueSize="md"
          icon={CircleHelp}
          label="Suspect"
          value={fmtPct(overall.suspectPct)}
          sub={`${overall.suspect} cells`}
          toneClassName="text-amber-600 dark:text-amber-400"
        />
        <StatTile
          surface="muted"
          valueSize="md"
          icon={CircleAlert}
          label="Missing"
          value={fmtPct(overall.missingPct)}
          sub={`${overall.missing} cells`}
          toneClassName="text-destructive"
        />
      </div>

      {/* Per-tag breakdown */}
      <div className="space-y-2.5">
        {dataset.tags.map(tag => {
          const q = byTag[tag]
          if (!q) return null
          const meta = resolveTagMeta(tag)
          const showLabel = meta.label !== tag
          const dirty = q.missing + q.suspect
          return (
            <div key={tag} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-foreground">
                    {tag}
                  </span>
                  {showLabel && (
                    <span className="truncate text-muted-foreground">
                      {meta.label}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3 font-mono">
                  <span
                    className={cn(
                      'text-amber-600 dark:text-amber-400',
                      q.suspect === 0 && 'text-muted-foreground/50',
                    )}
                  >
                    {q.suspect} susp · {fmtPct(q.suspectPct)}
                  </span>
                  <span
                    className={cn(
                      'text-destructive',
                      q.missing === 0 && 'text-muted-foreground/50',
                    )}
                  >
                    {q.missing} miss · {fmtPct(q.missingPct)}
                  </span>
                  {dirty === 0 && (
                    <span className="text-emerald-600 dark:text-emerald-400">
                      clean
                    </span>
                  )}
                </div>
              </div>
              <QualityBar q={q} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
