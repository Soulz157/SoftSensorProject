'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Gauge,
  Thermometer,
} from 'lucide-react'
import { Alert } from '@/types/dashboard'

interface ActiveAlertsProps {
  alerts: Alert[]
}

export function ActiveAlerts({ alerts }: ActiveAlertsProps) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'normal':
      case 'running':
        return 'text-emerald-500'
      case 'warning':
        return 'text-amber-500'
      case 'alarm':
      case 'error':
        return 'text-red-500'
      default:
        return 'text-zinc-500'
    }
  }

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'normal':
      case 'running':
        return 'bg-emerald-500/10'
      case 'warning':
        return 'bg-amber-500/10'
      case 'alarm':
      case 'error':
        return 'bg-red-500/10'
      default:
        return 'bg-zinc-500/10'
    }
  }

  const getNodeTypeIcon = (type?: string) => {
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

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
        <AlertTriangle className="h-5 w-5 text-amber-500" />
        Active Alerts
        {alerts.length > 0 && (
          <Badge variant="secondary" className="bg-amber-500/10 text-amber-500">
            {alerts.length}
          </Badge>
        )}
      </h2>

      <Card className="border-border bg-card">
        <div className="max-h-96 divide-y divide-border overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
              <p>No active alerts</p>
              <p className="mt-1 text-xs">All systems operating normally</p>
            </div>
          ) : (
            alerts.map((alert, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`rounded-md p-2 ${getStatusBg(alert.status)} ${getStatusColor(alert.status)}`}
                  >
                    {alert.type === 'node' ? (
                      (() => {
                        const Icon = getNodeTypeIcon(alert.nodeType)
                        return <Icon className="h-4 w-4" />
                      })()
                    ) : (
                      <BrainCircuit className="h-4 w-4" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {alert.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {alert.workspace}
                      {alert.type === 'model' && ` • ${alert.nodeName}`}
                    </p>
                  </div>
                </div>
                <Link href={`/workspaces/${alert.workspaceId}`}>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
