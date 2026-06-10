'use client'

import { use } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/app-layout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Box,
  ArrowLeft,
  Play,
  Pause,
  RefreshCw,
  Settings,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  TrendingUp,
  Clock,
  Cpu,
  Activity,
} from 'lucide-react'

interface ModelData {
  id: string
  name: string
  workspace: string
  workspaceId: string
  status: 'running' | 'stopped' | 'error'
  accuracy: string
  lastTrained: string
  lastRun: string
  type: string
  description: string
  version: string
  createdAt: string
  trainingHistory: { date: string; accuracy: number }[]
  logs: {
    timestamp: string
    message: string
    type: 'info' | 'warning' | 'error'
  }[]
  nodes: {
    id: string
    name: string
    status: 'online' | 'warning' | 'offline'
  }[]
}

const modelsData: Record<string, ModelData> = {
  '1': {
    id: '1',
    name: 'Temperature Predictor',
    workspace: 'Acme Corporation',
    workspaceId: '1',
    status: 'running',
    accuracy: '94.2%',
    lastTrained: '2 days ago',
    lastRun: '2 min ago',
    type: 'Regression',
    description:
      'Predicts temperature variations in manufacturing equipment to prevent overheating and optimize cooling systems.',
    version: '2.4.1',
    createdAt: 'Jan 15, 2024',
    trainingHistory: [
      { date: 'Jan 15', accuracy: 85.2 },
      { date: 'Feb 01', accuracy: 88.7 },
      { date: 'Feb 15', accuracy: 91.3 },
      { date: 'Mar 01', accuracy: 92.8 },
      { date: 'Mar 15', accuracy: 94.2 },
    ],
    logs: [
      {
        timestamp: '2 min ago',
        message: 'Prediction completed successfully',
        type: 'info',
      },
      {
        timestamp: '5 min ago',
        message: 'Input data processed: 1,247 records',
        type: 'info',
      },
      {
        timestamp: '8 min ago',
        message: 'Memory usage at 78%',
        type: 'warning',
      },
      {
        timestamp: '15 min ago',
        message: 'Model checkpoint saved',
        type: 'info',
      },
      {
        timestamp: '30 min ago',
        message: 'Batch processing started',
        type: 'info',
      },
    ],
    nodes: [
      { id: 'n1', name: 'CNC Machine A1', status: 'online' },
      { id: 'n4', name: 'Temperature Sensor T1', status: 'online' },
    ],
  },
  '2': {
    id: '2',
    name: 'Demand Forecaster',
    workspace: 'Acme Corporation',
    workspaceId: '1',
    status: 'running',
    accuracy: '91.8%',
    lastTrained: '1 week ago',
    lastRun: '5 min ago',
    type: 'Time Series',
    description:
      'Forecasts product demand based on historical data and market trends to optimize inventory management.',
    version: '1.8.3',
    createdAt: 'Dec 10, 2023',
    trainingHistory: [
      { date: 'Dec 10', accuracy: 82.1 },
      { date: 'Jan 01', accuracy: 85.4 },
      { date: 'Jan 15', accuracy: 88.2 },
      { date: 'Feb 01', accuracy: 90.5 },
      { date: 'Feb 15', accuracy: 91.8 },
    ],
    logs: [
      {
        timestamp: '5 min ago',
        message: 'Forecast generated for next 7 days',
        type: 'info',
      },
      {
        timestamp: '10 min ago',
        message: 'Data ingestion completed',
        type: 'info',
      },
      {
        timestamp: '1 hour ago',
        message: 'Model accuracy validated',
        type: 'info',
      },
    ],
    nodes: [{ id: 'n6', name: 'Main Controller', status: 'online' }],
  },
}

export default function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const model = modelsData[id] ?? modelsData['1']!

  const getStatusIcon = (status: ModelData['status']) => {
    switch (status) {
      case 'running':
        return <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      case 'stopped':
        return <XCircle className="h-5 w-5 text-muted-foreground" />
      case 'error':
        return <AlertTriangle className="h-5 w-5 text-amber-500" />
    }
  }

  const getStatusBadge = (status: ModelData['status']) => {
    switch (status) {
      case 'running':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
      case 'stopped':
        return 'bg-muted text-muted-foreground border-border'
      case 'error':
        return 'bg-amber-500/10 text-amber-500 border-amber-500/20'
    }
  }

  const getLogTypeColor = (type: string) => {
    switch (type) {
      case 'info':
        return 'text-primary'
      case 'warning':
        return 'text-amber-500'
      case 'error':
        return 'text-red-500'
      default:
        return 'text-muted-foreground'
    }
  }

  const maxAccuracy = Math.max(...model.trainingHistory.map(h => h.accuracy))

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Back Button & Header */}
      <div className="mb-6">
        <Link
          href="/models"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
              <Box className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold text-foreground">
                  {model.name}
                </h1>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${getStatusBadge(model.status)}`}
                >
                  {getStatusIcon(model.status)}
                  <span className="capitalize">{model.status}</span>
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {model.workspace} - {model.type} - v{model.version}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {model.status === 'running' ? (
              <Button variant="outline" className="gap-2">
                <Pause className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button className="gap-2">
                <Play className="h-4 w-4" />
                Start
              </Button>
            )}
            <Button variant="outline" className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Retrain
            </Button>
            <Button variant="ghost" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Accuracy</p>
                <p className="text-2xl font-bold text-foreground">
                  {model.accuracy}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Last Trained</p>
                <p className="text-2xl font-bold text-foreground">
                  {model.lastTrained}
                </p>
              </div>
              <RefreshCw className="h-8 w-8 text-primary" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Last Run</p>
                <p className="text-2xl font-bold text-foreground">
                  {model.lastRun}
                </p>
              </div>
              <Clock className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Nodes</p>
                <p className="text-2xl font-bold text-foreground">
                  {model.nodes.length}
                </p>
              </div>
              <Cpu className="h-8 w-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Description */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base font-medium">Description</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{model.description}</p>
          </CardContent>
        </Card>

        {/* Accuracy History */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">
              Accuracy History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3 h-40">
              {model.trainingHistory.map((point, i) => (
                <div
                  key={i}
                  className="flex-1 flex flex-col items-center gap-2"
                >
                  <div className="w-full flex flex-col items-center">
                    <span className="text-xs font-medium text-foreground mb-1">
                      {point.accuracy}%
                    </span>
                    <div
                      className="w-full bg-primary rounded-t transition-all"
                      style={{
                        height: `${(point.accuracy / maxAccuracy) * 100}px`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground">
                    {point.date}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Active Nodes */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-base font-medium">Deployed On</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {model.nodes.map(node => (
                <Link
                  key={node.id}
                  href={`/workspace/${model.workspaceId}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border bg-background/50 hover:bg-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Cpu className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">
                      {node.name}
                    </span>
                  </div>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      node.status === 'online'
                        ? 'bg-emerald-500'
                        : node.status === 'warning'
                          ? 'bg-amber-500'
                          : 'bg-red-500'
                    }`}
                  />
                </Link>
              ))}
              {model.nodes.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Not deployed on any nodes
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Logs */}
        <Card className="bg-card border-border lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-medium">Recent Logs</CardTitle>
            <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
              <Activity className="h-3.5 w-3.5" />
              View All
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {model.logs.map((log, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 transition-colors"
                >
                  <span
                    className={`text-xs font-mono ${getLogTypeColor(log.type)}`}
                  >
                    [{log.type.toUpperCase()}]
                  </span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {log.timestamp}
                  </span>
                  <span className="text-xs text-foreground">{log.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
