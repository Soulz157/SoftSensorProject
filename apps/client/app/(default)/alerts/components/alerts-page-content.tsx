'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { useAlerts } from '@/hooks/alerts/use-alerts'
import { useWorkspaces } from '@/hooks/workspace/use-workspaces'
import {
  countByStatus,
  filterAlerts,
  groupByWorkspace,
  EMPTY_FILTERS,
  type AlertFilters,
} from '@/lib/alerts'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Card } from '@/components/ui/card'
import { AlertsKpiCards } from './alerts-kpi-cards'
import { AlertsToolbar } from './alerts-toolbar'
import { AlertsGroupList } from './alerts-group-list'
import AlertsLoading from '../loading'

export function AlertsPageContent() {
  const { alerts, loading } = useAlerts()
  const { workspaces } = useWorkspaces()
  const [filters, setFilters] = useState<AlertFilters>(EMPTY_FILTERS)
  if (loading) return <AlertsLoading />

  const tabRows = alerts
  const filteredRows = filterAlerts(tabRows, filters)
  const groups = groupByWorkspace(filteredRows)
  const counts = countByStatus(alerts)

  return (
    <div className="p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link
                href="/overview"
                className="text-muted-foreground hover:text-foreground"
              >
                Overview
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>System Alerts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          Alerts Overview
        </h1>

        <AlertsKpiCards counts={counts} />

        {alerts.length === 0 ? (
          <Card className="rounded-xl bg-card p-12 text-center shadow-none ring-1 ring-foreground/10">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
            <p className="text-lg font-semibold text-foreground">
              No active alerts
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              All systems operating normally
            </p>
          </Card>
        ) : (
          <>
            {/* <Tabs value={activeTab} onValueChange={v => setTab(v as Tab)}>
              <TabsList className="flex h-auto w-full flex-row flex-wrap justify-start gap-2 bg-transparent p-0">
                <TabsTrigger
                  value="equipment"
                  className="cursor-pointer gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium transition-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  <Network className="h-4 w-4" />
                  Equipment Alerts
                  {nodeAlerts.length > 0 && (
                    <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                      {nodeAlerts.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="model-errors"
                  className="cursor-pointer gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium transition-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  <Box className="h-4 w-4" />
                  Model Errors
                  {modelAlerts.length > 0 && (
                    <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                      {modelAlerts.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="all"
                  className="cursor-pointer gap-2 rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium transition-none data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm"
                >
                  All Events
                  <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-foreground/10 text-xs font-semibold">
                    {alerts.length}
                  </span>
                </TabsTrigger>
              </TabsList>
            </Tabs> */}

            <AlertsToolbar filters={filters} onChange={setFilters} />

            <AlertsGroupList groups={groups} workspaces={workspaces} />
          </>
        )}
      </div>
    </div>
  )
}
