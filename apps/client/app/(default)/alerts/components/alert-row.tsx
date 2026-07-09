'use client'

import { Fragment, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import {
  Activity,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  CpuIcon,
  Gauge,
  Network,
  Thermometer,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TableCell, TableRow } from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { locationBreadcrumb, type AlertRow as AlertRowData } from '@/lib/alerts'
import { AlertStatusBadge } from './alert-status-badge'

const COLUMN_COUNT = 8

function getTypeIcon(row: AlertRowData, className?: string) {
  const iconClassName = cn('h-3.5 w-3.5 shrink-0', className)
  if (row.kind === 'model') return <Box className={iconClassName} />
  const label = row.typeLabel.toLowerCase()
  if (label.startsWith('sensor'))
    return <Thermometer className={iconClassName} />
  if (label.startsWith('controller')) return <Gauge className={iconClassName} />
  if (label.startsWith('machine')) return <Cpu className={iconClassName} />
  return <Activity className={iconClassName} />
}

function formatTime(ts: string): string {
  try {
    return format(new Date(ts), 'HH:mm:ss')
  } catch {
    return ts
  }
}

function formatDate(ts: string): string {
  try {
    return format(new Date(ts), 'dd MMM yyyy')
  } catch {
    return ts
  }
}

function hasExpandableDetail(row: AlertRowData): boolean {
  return row.kind === 'model' && Boolean(row.errorLogs?.length)
}

function TruncatedText({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('block truncate', className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{text}</TooltipContent>
    </Tooltip>
  )
}

export function AlertRow({ row }: { row: AlertRowData }) {
  const [expanded, setExpanded] = useState(false)
  const Icon = getTypeIcon(row)

  const canExpand = hasExpandableDetail(row)
  const title = row.kind === 'model' ? row.modelName : row.equipmentName

  return (
    <Fragment>
      <TableRow
        className={cn('hover:bg-muted/40', canExpand && 'cursor-pointer')}
        onClick={canExpand ? () => setExpanded(v => !v) : undefined}
      >
        <TableCell className="w-8 text-muted-foreground">
          {canExpand &&
            (expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            ))}
        </TableCell>

        <TableCell className="w-28">
          <AlertStatusBadge status={row.status} />
        </TableCell>

        <TableCell className="w-28 font-mono text-xs leading-tight text-muted-foreground">
          <div>{formatTime(row.timestamp)}</div>
          <div>{formatDate(row.timestamp)}</div>
        </TableCell>

        <TableCell className="w-24">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            {Icon}
            <span className="truncate text-xs">{row.equipmentName}</span>
          </div>
        </TableCell>

        <TableCell className="w-56 max-w-56">
          <span className="block truncate text-sm font-semibold text-foreground">
            <CpuIcon className="mr-1 inline h-3 w-3 text-muted-foreground" />
            {title}
          </span>
        </TableCell>

        <TableCell className="min-w-0 max-w-xs">
          {row.detailError ? (
            <TruncatedText
              text={row.detailError}
              className="text-sm text-muted-foreground"
            />
          ) : (
            <span className="text-sm text-muted-foreground/40">—</span>
          )}
        </TableCell>

        <TableCell className="md:table-cell">
          <div className="flex items-center gap-1">
            {locationBreadcrumb(row).map((segment, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                )}
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground">
                  {segment}
                </span>
              </span>
            ))}
          </div>
        </TableCell>

        <TableCell
          className="w-28 text-right"
          onClick={e => e.stopPropagation()}
        >
          <Link href={row.href}>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg shadow-none ring-1 ring-foreground/10"
            >
              View Details
            </Button>
          </Link>
        </TableCell>
      </TableRow>

      {canExpand && expanded && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={COLUMN_COUNT} className="bg-muted/20 p-0">
            <div className="space-y-3 px-4 py-3 pl-15">
              {row.errorLogs && row.errorLogs.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Recent Errors
                  </p>
                  <ul className="space-y-1.5">
                    {row.errorLogs.map((log, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className="mt-1.25 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                        <span className="flex-1 font-mono leading-relaxed text-foreground">
                          {log.message}
                        </span>
                        <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                          {formatTime(log.timestamp)} ·{' '}
                          {formatDate(log.timestamp)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {row.affectedNode && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
                    Location
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                      <Network className="h-3 w-3 text-muted-foreground" />
                      {row.workspaceName}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground">
                      <Cpu className="h-3 w-3 text-muted-foreground" />
                      {row.affectedNode.name}
                      {row.affectedNode.planName && (
                        <span className="text-muted-foreground">
                          · {row.affectedNode.planName}
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  )
}
