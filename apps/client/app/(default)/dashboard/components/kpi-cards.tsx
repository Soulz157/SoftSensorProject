'use client'

import { Card, CardContent } from '@/components/ui/card'
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Cpu,
  Gauge,
  Layers,
  Server,
  Thermometer,
  TrendingUp,
} from 'lucide-react'

interface KpiCardsProps {
  totalWorkspaces: number
  totalNodes: number
  machineCount: number
  sensorCount: number
  controllerCount: number
  runningModels: number
  totalModels: number
  warningModels: number
  alertsCount: number
}

export function KpiCards({
  totalWorkspaces,
  totalNodes,
  machineCount,
  sensorCount,
  controllerCount,
  runningModels,
  totalModels,
  warningModels,
  alertsCount,
}: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Total Workspaces
              </p>
              <p className="text-3xl font-bold text-foreground">
                {totalWorkspaces}
              </p>
            </div>
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Layers className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-emerald-500">
              <TrendingUp className="h-3 w-3" />
              +2 this month
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Total Nodes
              </p>
              <p className="text-3xl font-bold text-foreground">{totalNodes}</p>
            </div>
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Server className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              {machineCount}
            </span>
            <span className="flex items-center gap-1">
              <Thermometer className="h-3 w-3" />
              {sensorCount}
            </span>
            <span className="flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              {controllerCount}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                AI Models
              </p>
              <p className="text-3xl font-bold text-foreground">
                {runningModels}
                <span className="text-lg font-normal text-muted-foreground">
                  /{totalModels || '0'}
                </span>
              </p>
            </div>
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <BrainCircuit className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-500">
              <CheckCircle2 className="h-3 w-3" /> {runningModels} running
            </span>
            {warningModels > 0 && (
              <span className="flex items-center gap-1 text-amber-500">
                <AlertTriangle className="h-3 w-3" /> {warningModels} warning
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                System Health
              </p>
              <p
                className={`text-3xl font-bold ${alertsCount > 0 ? 'text-amber-500' : 'text-emerald-500'}`}
              >
                {alertsCount > 0 ? 'Warning' : 'Healthy'}
              </p>
            </div>
            <div
              className={`rounded-md p-2 ${alertsCount > 0 ? 'bg-amber-500/10 text-amber-500' : 'bg-emerald-500/10 text-emerald-500'}`}
            >
              {alertsCount > 0 ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
            </div>
          </div>
          <div className="mt-4 text-xs text-muted-foreground">
            {alertsCount} alerts require attention
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
