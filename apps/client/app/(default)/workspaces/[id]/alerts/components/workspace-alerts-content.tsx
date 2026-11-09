'use client'

import Link from 'next/link'
import {
  ALERT_STATUS_LABEL,
  type AlertStatus as SharedAlertStatus,
} from '@/lib/alerts'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import {
  ArrowRight,
  CheckCircle2,
  Activity,
  Cpu,
  FlaskConical,
  Thermometer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { EQUIPMENT_STATUS_PRIORITY } from '@/constants/status'
import AlertsWorkspaceLoading from '../loading'
import { useWorkspaceEquipment } from '@/hooks/workspace/use-workspace-equipment'
import { useWorkspace } from '@/hooks/workspace/use-workspace-by'

type EquipmentType = 'reactor' | 'machine' | 'sensor'
type AlertStatus = 'warning' | 'alarm' | 'offline'

interface AlertRow {
  nodeId: string
  nodeName: string
  nodeType: EquipmentType
  status: AlertStatus
}

function getEquipmentTypeIcon(type: EquipmentType) {
  switch (type) {
    case 'machine':
      return Cpu
    case 'sensor':
      return Thermometer
    case 'reactor':
      return FlaskConical
    default:
      return Activity
  }
}

// MODEL-SERVE-024-D01/D02. The shared status vocabulary: a stored 'alarm'
// node reads "Alert" (red, Abnormal); warning (amber) and offline (grey) are
// listed but do NOT make the workspace Abnormal — the same labels and colours
// as the global Alerts page.
const EQUIPMENT_TO_ALERT_STATUS: Record<AlertStatus, SharedAlertStatus> = {
  alarm: 'alert',
  warning: 'warning',
  offline: 'offline',
}
const STATUS_CLASS: Record<AlertStatus, string> = {
  alarm: 'bg-red-500/10 text-red-500',
  offline: 'bg-zinc-500/10 text-zinc-500',
  warning: 'bg-amber-500/10 text-amber-500',
}

interface WorkspaceAlertsContentProps {
  workspaceId: string
}

export function WorkspaceAlertsContent({
  workspaceId,
}: WorkspaceAlertsContentProps) {
  const { workspace, loading: workspaceLoading } = useWorkspace(workspaceId)
  const { equipmentList, loading: equipmentLoading } =
    useWorkspaceEquipment(workspaceId)

  if (equipmentLoading || workspaceLoading) {
    return <AlertsWorkspaceLoading />
  }

  const alerts: AlertRow[] = (equipmentList ?? [])
    .filter(
      equipment =>
        equipment.data.status === 'alarm' ||
        equipment.data.status === 'offline' ||
        equipment.data.status === 'warning',
    )
    .map(equipment => ({
      nodeId: equipment.id,
      nodeName: equipment.data.name,
      nodeType: equipment.data.type as EquipmentType,
      status: equipment.data.status as AlertStatus,
    }))
    .sort(
      (a, b) =>
        (EQUIPMENT_STATUS_PRIORITY[a.status] ?? 99) -
        (EQUIPMENT_STATUS_PRIORITY[b.status] ?? 99),
    )

  const alarmCount = alerts.filter(a => a.status === 'alarm').length
  const warningCount = alerts.filter(a => a.status === 'warning').length
  const offlineCount = alerts.filter(a => a.status === 'offline').length

  const workspaceName = workspace?.name || workspaceId

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Breadcrumb */}
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <Link
                href="/overview"
                className="text-muted-foreground hover:text-foreground"
              >
                Dashboard
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <Link
                href={`/plants/${workspaceId}`}
                className="text-muted-foreground hover:text-foreground"
              >
                {workspaceName}
              </Link>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>Alerts</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            {workspaceName} Alerts
          </h1>
          {alarmCount > 0 && (
            <Badge variant="secondary" className="bg-red-500/10 text-red-500">
              {alarmCount} alert{alarmCount > 1 ? 's' : ''}
            </Badge>
          )}
          {warningCount > 0 && (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-500"
            >
              {warningCount} warning{warningCount > 1 ? 's' : ''}
            </Badge>
          )}
          {offlineCount > 0 && (
            <Badge variant="secondary" className="bg-zinc-500/10 text-zinc-500">
              {offlineCount} offline
            </Badge>
          )}
        </div>

        {alerts.length === 0 ? (
          <Card className="border-border bg-card p-12 text-center">
            <CheckCircle2 className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
            <p className="text-lg font-semibold text-foreground">
              No active alerts
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              All systems in this workspace are operating normally
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Equipment Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((alert, index) => {
                  const Icon = getEquipmentTypeIcon(alert.nodeType)
                  return (
                    <TableRow key={alert.nodeId}>
                      <TableCell className="text-muted-foreground">
                        {index + 1}
                      </TableCell>

                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                            STATUS_CLASS[alert.status] ??
                              'bg-zinc-500/10 text-zinc-500',
                          )}
                        >
                          {
                            ALERT_STATUS_LABEL[
                              EQUIPMENT_TO_ALERT_STATUS[alert.status]
                            ]
                          }
                        </span>
                      </TableCell>

                      {/* Equipment Name */}
                      <TableCell className="font-semibold text-foreground">
                        {alert.nodeName}
                      </TableCell>

                      {/* Type */}
                      <TableCell>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <span className="capitalize">{alert.nodeType}</span>
                        </span>
                      </TableCell>

                      {/* Navigate to equipment */}
                      <TableCell>
                        <Link
                          href={`/plants/${workspaceId}?nodeId=${alert.nodeId}`}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  )
}
