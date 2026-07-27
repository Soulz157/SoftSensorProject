'use client'

import { useMemo } from 'react'
import {
  Cpu,
  Database,
  FileText,
  LayoutGrid,
  Plug,
  Tags as TagsIcon,
  type LucideIcon,
} from 'lucide-react'
import type { SavedDataset } from '@/store/datasets'
import type { DataSourceKind } from '@/lib/mock-data-sources'
import { useDatasetDetail } from '@/hooks/dataset/use-dataset-detail'
import { datasetTimeSpanLabel } from '@/lib/dataset-stats'
import { tagDistribution } from '@/lib/data-quality'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { DataTableView } from '@/app/(default)/data-visualize/components/data-table-view'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const SOURCE_META: Record<DataSourceKind, { label: string; icon: LucideIcon }> =
  {
    aveva: { label: 'AVEVA PI', icon: Cpu },
    sql: { label: 'SQL', icon: Database },
    csv: { label: 'CSV', icon: FileText },
    api: { label: 'API', icon: Plug },
  }

export interface DetailSource {
  name: string
  type: DataSourceKind | null
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function KpiCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 truncate font-mono text-lg font-semibold text-foreground">
        {value}
      </p>
      {sub && <p className="text-[10px] text-muted-foreground/70">{sub}</p>}
    </div>
  )
}

interface Props {
  dataset: SavedDataset | null
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceName: string
  sources: DetailSource[]
}

export function DatasetDetailSheet({
  dataset,
  open,
  onOpenChange,
  workspaceName,
  sources,
}: Props) {
  const { ds, topPairs } = useDatasetDetail(dataset)
  const timeSpan = datasetTimeSpanLabel(ds)

  const perTagStats = useMemo(
    () =>
      ds.tags.map(tag => {
        const d = tagDistribution(ds, tag)
        return {
          tag,
          mean: d.mean,
          median: d.median,
          sd: d.std,
          max: d.max,
          min: d.min,
        }
      }),
    [ds],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-y-auto p-0 data-[side=right]:sm:max-w-xl"
      >
        {dataset && (
          <>
            {/* Header — identity + lineage */}
            <SheetHeader className="gap-2 border-b border-border p-5">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                <LayoutGrid className="h-3.5 w-3.5" />
                {workspaceName}
              </div>
              <SheetTitle className="text-lg">{dataset.name}</SheetTitle>
              {dataset.description && (
                <SheetDescription>{dataset.description}</SheetDescription>
              )}
              <div className="mt-1 flex flex-wrap gap-1.5">
                {sources.length === 0 ? (
                  <Badge variant="secondary">No source</Badge>
                ) : (
                  sources.map((s, i) => {
                    const meta = s.type ? SOURCE_META[s.type] : null
                    const Icon = meta?.icon ?? Database
                    return (
                      <Badge
                        key={`${s.name}-${i}`}
                        variant="secondary"
                        className="gap-1.5 font-medium text-foreground"
                      >
                        <Icon className="h-3 w-3 text-primary" />
                        {meta?.label ?? 'Source'}
                        <span className="text-muted-foreground">
                          · {s.name}
                        </span>
                      </Badge>
                    )
                  })
                )}
              </div>
            </SheetHeader>

            <div className="space-y-5 p-5">
              {/* KPI overview */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <KpiCard
                  label="Rows"
                  value={dataset.rowCount.toLocaleString()}
                />
                <KpiCard label="Features" value={String(dataset.tags.length)} />
                <KpiCard label="Time span of data" value={timeSpan} />
              </div>

              {/* Tags scroll area */}
              <section className="space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                  <TagsIcon className="h-4 w-4 text-primary" />
                  Tags ({dataset.tags.length})
                </div>
                <ScrollArea className="h-40 rounded-lg border border-border bg-muted/20 p-3">
                  <div className="flex flex-wrap gap-1.5">
                    {dataset.tags.map(t => (
                      <Badge key={t} variant="outline" className="font-mono">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </ScrollArea>
              </section>

              {/* Per-tag statistics */}
              {perTagStats.length > 0 && (
                <section className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">
                    Per-tag statistics
                  </p>
                  <ScrollArea className="h-56 rounded-lg border border-border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-card">
                          <TableHead className="sticky top-0 bg-card">
                            Tag
                          </TableHead>
                          <TableHead className="sticky top-0 bg-card text-right">
                            Mean
                          </TableHead>
                          <TableHead className="sticky top-0 bg-card text-right">
                            Median
                          </TableHead>
                          <TableHead className="sticky top-0 bg-card text-right">
                            Max
                          </TableHead>
                          <TableHead className="sticky top-0 bg-card text-right">
                            Min
                          </TableHead>
                          <TableHead className="sticky top-0 bg-card text-right">
                            SD
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {perTagStats.map(s => (
                          <TableRow key={s.tag}>
                            <TableCell className="font-mono text-foreground">
                              {s.tag}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {fmt(s.mean)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {fmt(s.median)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {fmt(s.max)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {fmt(s.min)}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {fmt(s.sd)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </section>
              )}

              {/* Top correlated tag pairs */}
              {topPairs.length > 0 && (
                <Card className="overflow-hidden shadow-sm">
                  <CardHeader className="bg-muted/30 px-4 py-3 border-b border-border">
                    <CardTitle className="text-sm font-semibold text-foreground">
                      Top correlated tags
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y divide-border">
                      {topPairs.map((p, i) => {
                        const isHighCorrelation = Math.abs(p.r) >= 0.8

                        return (
                          <li
                            key={`${p.a}-${p.b}`}
                            className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs transition-colors hover:bg-muted/50"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="text-muted-foreground">
                                {i + 1}.
                              </span>
                              <span className="truncate font-mono text-foreground font-medium">
                                {p.a}{' '}
                                <span className="text-muted-foreground mx-1">
                                  ↔
                                </span>{' '}
                                {p.b}
                              </span>
                            </span>

                            <Badge
                              variant={
                                isHighCorrelation ? 'default' : 'secondary'
                              }
                              className={`shrink-0 font-mono ${isHighCorrelation ? 'bg-primary' : ''}`}
                            >
                              {p.r >= 0 ? '+' : ''}
                              {p.r.toFixed(2)}
                            </Badge>
                          </li>
                        )
                      })}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Data preview */}
              <section className="space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  Data preview
                </p>
                <DataTableView dataset={ds} showQuality />
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
