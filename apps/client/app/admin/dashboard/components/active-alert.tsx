'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Gauge,
  Thermometer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Alert } from '@/types/dashboard'

interface ActiveAlertsProps {
  alerts: Alert[]
}

function getStatusColor(status: string) {
  switch (status) {
    case 'warning':
      return 'text-amber-500'
    case 'alarm':
    case 'error':
    case 'offline':
      return 'text-red-500'
    default:
      return 'text-zinc-500'
  }
}

function getStatusBg(status: string) {
  switch (status) {
    case 'warning':
      return 'bg-amber-500/10'
    case 'alarm':
    case 'error':
    case 'offline':
      return 'bg-red-500/10'
    default:
      return 'bg-zinc-500/10'
  }
}

function getNodeTypeIcon(type?: string) {
  switch (type) {
    case 'machine':
      return Cpu
    case 'sensor':
      return Thermometer
    case 'controller':
      return Gauge
    default:
      return Activity
  }
}

export function ActiveAlerts({ alerts }: ActiveAlertsProps) {
  const visibleAlerts = alerts.slice(0, 5)
  const remainingCount = alerts.length - 5

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Recent Alerts
          {alerts.length > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500"
            >
              {alerts.length}
            </Badge>
          )}
        </h2>
        <Link href="/alerts">
          <Button variant="ghost" size="sm">
            View All Alerts
          </Button>
        </Link>
      </div>

      <Card className="border-border bg-card">
        <div className="divide-y divide-border">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
              <p className="font-medium">No active alerts</p>
              <p className="mt-1 text-xs">All systems operating normally</p>
            </div>
          ) : (
            visibleAlerts.map((alert, index) => {
              const Icon = getNodeTypeIcon(alert.nodeType)
              const isAlarm =
                alert.status === 'alarm' ||
                alert.status === 'error' ||
                alert.status === 'offline'

              return (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'rounded-md p-2',
                        getStatusBg(alert.status),
                        getStatusColor(alert.status),
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {alert.name}
                      </p>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {alert.workspace}
                        <span>·</span>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium',
                            isAlarm
                              ? 'bg-red-500/10 text-red-500'
                              : 'bg-amber-500/10 text-amber-500',
                          )}
                        >
                          {alert.status}
                        </span>
                      </p>
                    </div>
                  </div>
                  <Link href={`/workspaces/${alert.workspaceId}`}>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              )
            })
          )}
        </div>
        {remainingCount > 0 && (
          <div className="border-t border-border px-3 py-2 text-center">
            <Link
              href="/alerts"
              className="text-xs text-muted-foreground hover:text-primary"
            >
              and {remainingCount} more…
            </Link>
          </div>
        )}
      </Card>
    </div>
  )
}
