'use client'

import { Activity, Database, Gauge, Tags } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { PipelineKpis } from '@/lib/pipeline-metrics'

interface Props {
  kpis: PipelineKpis
}

const compact = new Intl.NumberFormat('en', { notation: 'compact' })

export function PipelineKpiCards({ kpis }: Props) {
  const cards = [
    {
      label: 'Total Managed Tags',
      value: compact.format(kpis.managedTags),
      sub: 'Tracked across pipeline',
      icon: <Tags className="h-7 w-7 text-primary" />,
    },
    {
      label: 'Pipeline Uptime',
      value: `${kpis.uptimePct.toFixed(2)}%`,
      sub: `${kpis.batchesSynced}/${kpis.batchesTotal} batches synced`,
      icon: <Activity className="h-7 w-7 text-primary" />,
    },
    {
      label: 'Data Volume Today',
      value: compact.format(kpis.throughput),
      sub: 'Records ingested',
      icon: <Database className="h-7 w-7 text-primary" />,
    },
    {
      label: 'Live Latency',
      value: `${kpis.latencyMs}ms`,
      sub: 'PI connection health',
      icon: <Gauge className="h-7 w-7 text-primary" />,
    },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(card => (
        <Card key={card.label} className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              {card.icon}
            </div>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {card.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{card.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
