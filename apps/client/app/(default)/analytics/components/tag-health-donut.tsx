'use client'

import { useMemo } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { STATUS_COLORS } from '@/store/status-colors'
import type { TagHealth } from '@/lib/pipeline-metrics'

interface Props {
  health: TagHealth
}

export function TagHealthDonut({ health }: Props) {
  const segments = useMemo(
    () => [
      {
        key: 'good',
        label: 'Good / Active',
        value: health.good,
        color: STATUS_COLORS.normal,
        Icon: CheckCircle2,
      },
      {
        key: 'stale',
        label: 'Stale / Warning',
        value: health.stale,
        color: STATUS_COLORS.warning,
        Icon: AlertTriangle,
      },
      {
        key: 'bad',
        label: 'Bad / Error',
        value: health.bad,
        color: STATUS_COLORS.alarm,
        Icon: XCircle,
      },
    ],
    [health],
  )

  const total = health.good + health.stale + health.bad

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Tag Health Status
        </CardTitle>
        <p className="text-xs text-muted-foreground">{total} managed tags</p>
      </CardHeader>
      <CardContent>
        <div className="relative">
          <ResponsiveContainer width="100%" height={170}>
            <PieChart>
              <Pie
                data={segments}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {segments.map(s => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold tabular-nums text-foreground">
              {total}
            </span>
            <span className="text-[11px] text-muted-foreground">tags</span>
          </div>
        </div>

        <div className="mt-2 flex flex-col gap-2">
          {segments.map(s => (
            <div
              key={s.key}
              className="flex items-center justify-between text-xs"
            >
              <div className="flex items-center gap-2">
                <s.Icon className="h-3.5 w-3.5" style={{ color: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
              </div>
              <span className="font-medium tabular-nums text-foreground">
                {s.value}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
