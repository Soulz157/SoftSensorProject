'use client'

import Link from 'next/link'
import {
  Box,
  Building2,
  TrendingUp,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Plus,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface DashboardContentProps {
  onCreateWorkspace?: () => void
  onImportModel?: () => void
}

const stats = [
  {
    title: 'Total Workspaces',
    value: '3',
    description: 'Active companies',
    icon: Building2,
    href: '/',
  },
  {
    title: 'Total Models',
    value: '92',
    description: 'Across all workspaces',
    icon: Box,
    href: '/models',
  },
  {
    title: 'Active Models',
    value: '78',
    description: 'Running now',
    icon: TrendingUp,
    href: '/models?status=active',
  },
  {
    title: 'Last Updated',
    value: '2m',
    description: 'ago',
    icon: Clock,
    href: '/analytics',
  },
]

const models = [
  {
    id: '1',
    name: 'Temperature Predictor',
    workspace: 'Acme Corporation',
    workspaceId: '1',
    status: 'active',
    accuracy: '94.2%',
    lastRun: '2 min ago',
  },
  {
    id: '2',
    name: 'Demand Forecaster',
    workspace: 'Acme Corporation',
    workspaceId: '1',
    status: 'active',
    accuracy: '91.8%',
    lastRun: '5 min ago',
  },
  {
    id: '3',
    name: 'Anomaly Detector',
    workspace: 'TechFlow Inc',
    workspaceId: '2',
    status: 'warning',
    accuracy: '87.5%',
    lastRun: '12 min ago',
  },
  {
    id: '4',
    name: 'Quality Classifier',
    workspace: 'TechFlow Inc',
    workspaceId: '2',
    status: 'active',
    accuracy: '96.1%',
    lastRun: 'Just now',
  },
  {
    id: '5',
    name: 'Energy Optimizer',
    workspace: 'DataSense Ltd',
    workspaceId: '3',
    status: 'inactive',
    accuracy: '89.3%',
    lastRun: '1 hour ago',
  },
]

const workspacesSummary = [
  {
    id: '1',
    name: 'Acme Corporation',
    modelsCount: 24,
    activeModels: 22,
    status: 'healthy',
  },
  {
    id: '2',
    name: 'TechFlow Inc',
    modelsCount: 56,
    activeModels: 48,
    status: 'warning',
  },
  {
    id: '3',
    name: 'DataSense Ltd',
    modelsCount: 12,
    activeModels: 8,
    status: 'healthy',
  },
]

export function DashboardContent({
  onCreateWorkspace,
  onImportModel,
}: DashboardContentProps) {
  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Page Title */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of your workspaces and models
        </p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(stat => (
          <Link key={stat.title} href={stat.href}>
            <Card className="bg-card border-border hover:bg-accent/30 transition-colors cursor-pointer">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {stat.title}
                </CardTitle>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-foreground">
                  {stat.value}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Workspaces Overview */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-medium">Workspaces</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={onCreateWorkspace}
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {workspacesSummary.map(workspace => (
                <Link
                  key={workspace.id}
                  href={`/workspace/${workspace.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-4 transition-colors hover:bg-accent/30 cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {workspace.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {workspace.activeModels} / {workspace.modelsCount}{' '}
                        models active
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-medium text-foreground">
                        {workspace.modelsCount}
                      </p>
                      <p className="text-xs text-muted-foreground">models</p>
                    </div>
                    {workspace.status === 'healthy' && (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    )}
                    {workspace.status === 'warning' && (
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Models */}
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base font-medium">
              Recent Models
            </CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={onImportModel}
            >
              <Plus className="h-3.5 w-3.5" />
              Import
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {models.map(model => (
                <Link
                  key={model.id}
                  href={`/models/${model.id}`}
                  className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3 transition-colors hover:bg-accent/30 cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted">
                      <Box className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {model.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {model.workspace}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="text-xs font-medium text-foreground">
                        {model.accuracy}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {model.lastRun}
                      </p>
                    </div>
                    {model.status === 'active' && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    )}
                    {model.status === 'warning' && (
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                    )}
                    {model.status === 'inactive' && (
                      <span className="h-2 w-2 rounded-full bg-muted-foreground" />
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
