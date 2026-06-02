'use client'

import { Card, CardContent } from '@/components/ui/card'
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Gauge,
  Thermometer,
  Zap,
} from 'lucide-react'

interface SecondaryStatsProps {
  machineCount: number
  sensorCount: number
  controllerCount: number
  runningModels: number
  warningModels: number
  errorModels: number
}

export function SecondaryStats({
  machineCount,
  sensorCount,
  controllerCount,
  runningModels,
  warningModels,
  errorModels,
}: SecondaryStatsProps) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center">
          <Cpu className="mx-auto mb-2 h-6 w-6 text-primary" />
          <p className="text-2xl font-bold text-foreground">{machineCount}</p>
          <p className="text-xs text-muted-foreground">Machines</p>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center">
          <Thermometer className="mx-auto mb-2 h-6 w-6 text-primary" />
          <p className="text-2xl font-bold text-foreground">{sensorCount}</p>
          <p className="text-xs text-muted-foreground">Sensors</p>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center">
          <Gauge className="mx-auto mb-2 h-6 w-6 text-primary" />
          <p className="text-2xl font-bold text-foreground">
            {controllerCount}
          </p>
          <p className="text-xs text-muted-foreground">Controllers</p>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-500" />
          <p className="text-2xl font-bold text-foreground">{runningModels}</p>
          <p className="text-xs text-muted-foreground">Running</p>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="mx-auto mb-2 h-6 w-6 text-amber-500" />
          <p className="text-2xl font-bold text-foreground">{warningModels}</p>
          <p className="text-xs text-muted-foreground">Warning</p>
        </CardContent>
      </Card>
      <Card className="border-border bg-card">
        <CardContent className="p-4 text-center">
          <Zap className="mx-auto mb-2 h-6 w-6 text-red-500" />
          <p className="text-2xl font-bold text-foreground">{errorModels}</p>
          <p className="text-xs text-muted-foreground">Error</p>
        </CardContent>
      </Card>
    </div>
  )
}
