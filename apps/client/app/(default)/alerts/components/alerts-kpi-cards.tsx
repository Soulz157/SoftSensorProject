import { AlertCircle, AlertTriangle, Box, Power } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { AlertCounts } from '@/lib/alerts'

const KPI_DEFS = [
  {
    key: 'alarm' as const,
    label: 'Alarms',
    icon: AlertCircle,
    text: 'text-red-500',
    bg: 'bg-red-500/10',
  },
  {
    key: 'failed' as const,
    label: 'Deploy Failed',
    icon: Box,
    text: 'text-red-600',
    bg: 'bg-red-500/10',
  },
  {
    key: 'warning' as const,
    label: 'Warnings',
    icon: AlertTriangle,
    text: 'text-amber-500',
    bg: 'bg-amber-500/10',
  },
  {
    key: 'offline' as const,
    label: 'Offline',
    icon: Power,
    text: 'text-zinc-500',
    bg: 'bg-zinc-500/10',
  },
]

/** Compact KPI grid — always reflects global counts, unaffected by tab/toolbar filters. */
export function AlertsKpiCards({ counts }: { counts: AlertCounts }) {
  const visible = KPI_DEFS.filter(kpi => counts[kpi.key] > 0)
  if (visible.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {visible.map(kpi => {
        const Icon = kpi.icon
        return (
          <Card
            key={kpi.key}
            className="rounded-xl bg-card shadow-none ring-1 ring-foreground/10"
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    {kpi.label}
                  </p>
                  <p className={`text-2xl font-semibold ${kpi.text}`}>
                    {counts[kpi.key]}
                  </p>
                </div>
                <div className={`rounded-lg p-2 ${kpi.bg} ${kpi.text}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
