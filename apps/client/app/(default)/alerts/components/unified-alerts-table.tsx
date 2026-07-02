'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  ArrowUpDown,
  Box,
  ChevronDown,
  ChevronRight,
  Cpu,
  Gauge,
  Network,
  Thermometer,
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  formatLocation,
  sortAlerts,
  type AlertRow,
  type SortDir,
  type SortKey,
} from '@/lib/alerts'
import { AlertStatusBadge } from './alert-status-badge'

const DASH = <span className="text-muted-foreground/50">—</span>

function getTypeIcon(row: AlertRow) {
  if (row.kind === 'model') return Box
  const label = row.typeLabel.toLowerCase()
  if (label.startsWith('sensor')) return Thermometer
  if (label.startsWith('controller')) return Gauge
  return Cpu // machine
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ts
  }
}

function hasExpandableDetail(row: AlertRow): boolean {
  return (
    row.kind === 'model' &&
    Boolean(row.detailError || row.errorLogs?.length || row.affectedNode)
  )
}

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string
  column: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (key: SortKey) => void
  className?: string
}) {
  const active = sortKey === column
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {label}
        <ArrowUpDown
          className={cn(
            'h-3 w-3',
            active ? 'opacity-100' : 'opacity-40',
            active && sortDir === 'desc' && 'rotate-180',
          )}
        />
      </button>
    </TableHead>
  )
}

/** Cell text that truncates with a hover tooltip revealing the full value. */
function TruncatedCell({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn('block max-w-65 truncate', className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{text}</TooltipContent>
    </Tooltip>
  )
}

export function UnifiedAlertsTable({ alerts }: { alerts: AlertRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const rows = useMemo(
    () => sortAlerts(alerts, sortKey, sortDir),
    [alerts, sortKey, sortDir],
  )

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const toggle = (key: string) =>
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-muted/30 p-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
        No alerts match the current filters.
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={150}>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-foreground/10 bg-muted/30 hover:bg-muted/30">
                <TableHead className="w-8" />
                <TableHead>Equipment</TableHead>
                <TableHead>Model</TableHead>
                <SortHeader
                  label="Location"
                  column="location"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <TableHead>Type</TableHead>
                <SortHeader
                  label="Status"
                  column="status"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={onSort}
                />
                <TableHead>Detail Error</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const key = `${row.kind}-${row.id}`
                const Icon = getTypeIcon(row)
                const canExpand = hasExpandableDetail(row)
                const isOpen = expanded[key] ?? false

                return (
                  <Fragment key={key}>
                    <TableRow
                      className={cn(
                        'border-b border-foreground/5 transition-colors hover:bg-muted/40',
                        canExpand && 'cursor-pointer',
                        isOpen && 'bg-muted/30',
                      )}
                      onClick={canExpand ? () => toggle(key) : undefined}
                    >
                      <TableCell className="text-muted-foreground">
                        {canExpand ? (
                          isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )
                        ) : null}
                      </TableCell>

                      <TableCell className="font-medium text-foreground">
                        {row.equipmentName ?? DASH}
                      </TableCell>

                      <TableCell className="text-foreground">
                        {row.modelName ?? DASH}
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        <TruncatedCell text={formatLocation(row)} />
                      </TableCell>

                      <TableCell>
                        <span className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          {row.typeLabel}
                        </span>
                      </TableCell>

                      <TableCell>
                        <AlertStatusBadge status={row.status} />
                      </TableCell>

                      <TableCell className="text-muted-foreground">
                        {row.detailError ? (
                          <TruncatedCell text={row.detailError} />
                        ) : (
                          DASH
                        )}
                      </TableCell>

                      <TableCell onClick={e => e.stopPropagation()}>
                        <Link href={row.href}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg hover:bg-muted"
                            aria-label="View detail"
                          >
                            <ArrowRight className="h-4 w-4" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>

                    {canExpand && isOpen && (
                      <TableRow className="border-b border-foreground/5 bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={8} className="p-0">
                          <ExpandedDetail row={row} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </TooltipProvider>
  )
}

function ExpandedDetail({ row }: { row: AlertRow }) {
  return (
    <div className="space-y-4 px-12 py-4">
      {row.detailError && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
            Error Detail
          </p>
          <div className="rounded-lg bg-destructive/5 p-3">
            <p className="text-sm text-foreground">{row.detailError}</p>
          </div>
        </div>
      )}

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
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                  {formatTimestamp(log.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {row.affectedNode && (
        <div className="space-y-1.5 p-2">
          <p className="text-xs font-bold tracking-wider text-muted-foreground uppercase p-2">
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
  )
}
