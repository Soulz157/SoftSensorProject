'use client'

import React from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  CheckCircle,
  AlertTriangle,
  Layers,
  ChevronRight,
  Clock,
  Map,
  Siren,
  AlertCircle,
  RefreshCw,
  Activity,
  Network,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Workspace } from '@/types/dashboard'
import type { CanvasNode } from '@/services/canvas'
import { workspaceColors } from '@/store/workspace'
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow'

interface WorkspaceListProps {
  workspaces: Workspace[]
  nodesByWorkspace: Record<string, CanvasNode[]>
}

export function WorkspaceList({
  workspaces,
  nodesByWorkspace,
}: WorkspaceListProps) {
  return (
    <div className="space-y-4 lg:col-span-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Layers className="h-5 w-5 text-primary" />
          Workspaces Overview
        </h2>
        <Link href="/workspaces">
          <Button variant="ghost" size="sm" className="gap-1 text-primary">
            View All
            <ChevronRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Grid สำหรับ Workspaces */}
      {workspaces.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
          <Activity className="h-10 w-10 opacity-30" />
          <p className="text-base font-medium">No workspaces yet</p>
          <p className="text-sm">Create your first workspace to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 md:grid-cols-2">
          {workspaces.map(workspace => {
            const nodes = nodesByWorkspace[workspace.id] ?? []
            const alarmCount = nodes.filter(
              n => n.data.status === 'alarm',
            ).length
            const warnCount = nodes.filter(
              n => n.data.status === 'warning',
            ).length
            const activeCount = nodes.filter(
              n => n.data.status === 'normal',
            ).length
            const modelsCount = workspace.modelsCount ?? 0
            const modelIssuesCount = nodes.reduce((acc, node) => {
              const issuesInNode =
                node.models?.filter(m => {
                  const status = m.data?.status
                  return status === 'error' || status === 'warning'
                }).length || 0
              return acc + issuesInNode
            }, 0)

            const accentClass =
              workspaceColors.find(c => c.id === workspace.color)?.bg ??
              'bg-blue-500'

            const statusDot =
              alarmCount > 0
                ? 'bg-red-500'
                : warnCount > 0
                  ? 'bg-amber-500'
                  : 'bg-emerald-500'

            return (
              <div key={workspace.id} className="flex flex-col gap-4">
                <Card className="relative overflow-hidden border-border  dark:bg-[#0f1115] transition-all hover:border-primary/50">
                  <div
                    className={cn(
                      'absolute left-0 top-0 h-1 w-full',
                      accentClass,
                    )}
                  />
                  <CardContent className="flex h-full flex-col p-5">
                    {/* Header */}
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-md font-semibold text-foreground">
                        {workspace.name}
                      </h3>
                      <span className={cn('h-3 w-3 rounded-full', statusDot)} />
                    </div>

                    {/* 2-col: Device Status | Models Status */}
                    <div className="mb-4 grid grid-cols-2 gap-4">
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Device Status
                        </p>
                        <div className="space-y-2 text-sm text-foreground">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                              Active
                            </span>
                            <span className="font-medium">{activeCount}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                              Warning
                            </span>
                            <span className="font-medium">{warnCount}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <Siren className="h-3.5 w-3.5 text-red-500" />
                              Alert
                            </span>
                            <span className="font-medium">{alarmCount}</span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-medium text-muted-foreground">
                          Models Status
                        </p>
                        <div className="space-y-2 text-sm text-foreground">
                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />
                              Running
                            </span>
                            <span className="font-medium">{modelsCount}</span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-muted-foreground">
                              <RefreshCw className="h-3.5 w-3.5 text-blue-500" />
                              In Progress
                            </span>
                            <span className="font-medium text-muted-foreground">
                              0
                            </span>
                          </div>

                          <div className="flex items-center justify-between">
                            <span
                              className={`flex items-center gap-1.5 ${
                                modelIssuesCount > 0
                                  ? 'text-red-500 font-medium'
                                  : 'text-muted-foreground'
                              }`}
                            >
                              <AlertCircle className="h-3.5 w-3.5" />
                              Issues
                            </span>
                            <span
                              className={
                                modelIssuesCount > 0
                                  ? 'font-medium text-red-500'
                                  : 'font-medium text-muted-foreground'
                              }
                            >
                              {modelIssuesCount > 0 ? modelIssuesCount : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Circle indicators */}
                    <div className="mb-4 flex items-center justify-around">
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-emerald-500/20 bg-emerald-500/10">
                          <span className="text-lg font-bold text-emerald-500">
                            {activeCount}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Normal
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-amber-500/20 bg-amber-500/10">
                          <span className="text-lg font-bold text-amber-500">
                            {warnCount}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Warning
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-red-500/20 bg-red-500/10">
                          <span className="text-lg font-bold text-red-500">
                            {alarmCount}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Error
                        </span>
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground ">
                        <Clock className="h-3 w-3" />
                        {/* {workspace.updatedAt || 'N/A'} */}
                        Updated{' '}
                        {formatDistanceToNow(workspace.updatedAt, {
                          addSuffix: true,
                        })}
                      </span>
                      <span className="flex items-center gap-2">
                        <Link href={`/workspaces/${workspace.id}/details`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="cursor-pointer h-8 text-xs text-muted-foreground hover:text-foreground"
                          >
                            View Details
                          </Button>
                        </Link>
                        <Link href={`/workspaces/${workspace.id}/canvas`}>
                          <Button
                            size="sm"
                            className="cursor-pointer h-8 gap-1.5 text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm"
                          >
                            <Network className="h-3.5 w-3.5" />
                            Process Pipeline
                          </Button>
                        </Link>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
