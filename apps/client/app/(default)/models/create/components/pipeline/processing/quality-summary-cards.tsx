'use client'

import { useMemo } from 'react'
import { CircleAlert, CircleSlash, Layers } from 'lucide-react'
import { datasetQuality } from '@/lib/data-quality'
import type { Dataset } from '@/lib/preprocessing'

interface Props {
  dataset: Dataset
}

function fmtPct(n: number): string {
  return `${n.toFixed(1)}%`
}

export function QualitySummaryCards({ dataset }: Props) {
  const q = useMemo(() => datasetQuality(dataset), [dataset])

  const cards = [
    {
      key: 'tags',
      label: 'Total Tags',
      Icon: Layers,
      value: String(dataset.tags.length),
      sub: 'active signals',
      tone: 'text-foreground',
    },
    {
      key: 'null',
      label: 'Is Null',
      Icon: CircleSlash,
      value: fmtPct(q.missingPct),
      sub: `${q.missing.toLocaleString()} cells`,
      tone: 'text-destructive',
    },
    {
      key: 'missing',
      label: 'Missing Value',
      Icon: CircleAlert,
      value: fmtPct(q.suspectPct),
      sub: `${q.suspect.toLocaleString()} cells`,
      tone: 'text-amber-600 dark:text-amber-400',
    },
  ] as const

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {cards.map(({ key, label, Icon, value, sub, tone }) => (
        <div
          key={key}
          className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
        >
          <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            <Icon className="h-3.5 w-3.5" />
            {label}
          </p>
          <p className={`mt-1.5 font-mono text-2xl ${tone}`}>{value}</p>
          <p className="mt-0.5 text-[16px] text-muted-foreground">{sub}</p>
        </div>
      ))}
    </div>
  )
}
