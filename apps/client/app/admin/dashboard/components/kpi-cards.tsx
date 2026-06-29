'use client'

import { Card, CardContent } from '@/components/ui/card'
import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Layers,
  Server,
  TrendingUp,
} from 'lucide-react'

interface KpiCardsProps {
  totalWorkspaces: number
  totalNodes: number
  activeNodes: number
  warningNodes: number
  errorNodes: number
  totalModels: number
  alertsCount: number
}

export function KpiCards({
  totalWorkspaces,
  totalNodes,
  activeNodes,
  warningNodes,
  errorNodes,
  totalModels,
  alertsCount,
}: KpiCardsProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Card 1: Total Workspaces */}
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

      {/* Card 2: System Nodes */}
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                System Nodes
              </p>
              <p className="text-3xl font-bold text-foreground">{totalNodes}</p>
            </div>
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <Server className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Active: {activeNodes}
            </span>
            <span className="flex items-center gap-1 text-amber-500">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Warning: {warningNodes}
            </span>
            <span className="flex items-center gap-1 text-red-500">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
              Alert: {errorNodes}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Card 3: System AI Models */}
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                System AI Models
              </p>
              <p className="text-3xl font-bold text-foreground">
                {totalModels ? totalModels : '0'}
              </p>
            </div>
            <div className="rounded-md bg-primary/10 p-2 text-primary">
              <BrainCircuit className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1 text-emerald-500">
              Running: {totalModels ? totalModels : '0'}
            </span>
            <span>In Progress: —</span>
            <span>Issues: —</span>
          </div>
        </CardContent>
      </Card>

      {/* Card 4: Overall System Health */}
      <Card className="border-border bg-card">
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                Overall System Health
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
            {alertsCount > 0
              ? `${alertsCount} critical issues`
              : 'All systems normal'}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
