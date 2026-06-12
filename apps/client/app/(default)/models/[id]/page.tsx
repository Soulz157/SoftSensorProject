'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useAtomValue } from 'jotai'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Activity,
  ArrowLeft,
  Box,
  CheckCircle2,
  Cpu,
  Database,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  StopCircle,
  Terminal,
  WifiOff,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { workspacesAtom } from '@/store/workspace'
import { getModels, updateModel } from '@/services/model'
import { effectiveProdStatus } from '@/lib/model-status'
import type { AIModel } from '@/types'

const DEPLOY_CONFIG = {
  running: {
    icon: CheckCircle2,
    cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    label: 'Running',
  },
  stopped: {
    icon: StopCircle,
    cls: 'bg-muted text-muted-foreground border-border',
    label: 'Stopped',
  },
  error: {
    icon: XCircle,
    cls: 'bg-red-500/10 text-red-500 border-red-500/20',
    label: 'Failed',
  },
  initializing: {
    icon: RefreshCw,
    cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    label: 'Initializing',
  },
} as const

const PROD_CONFIG = {
  normal: {
    icon: Activity,
    cls: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
    label: 'Normal',
  },
  warning: {
    icon: Activity,
    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    label: 'Warning',
  },
  alert: {
    icon: XCircle,
    cls: 'bg-red-500/10 text-red-500 border-red-500/20',
    label: 'Alert',
  },
  offline: {
    icon: WifiOff,
    cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
    label: 'Offline',
  },
} as const

const LOG_CLS = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
} as const

function seedRand(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff
    return (s >>> 0) / 0xffffffff
  }
}

const SIGNALS = [
  { name: 'Temp_01', unit: '°C', base: 45, range: 20 },
  { name: 'Pressure_A', unit: 'bar', base: 3.2, range: 1.5 },
  { name: 'Vibration_X', unit: 'mm/s', base: 0.8, range: 0.6 },
  { name: 'Flow_In', unit: 'L/min', base: 120, range: 30 },
  { name: 'Torque_1', unit: 'Nm', base: 55, range: 15 },
  { name: 'Speed_RPM', unit: 'rpm', base: 1450, range: 200 },
  { name: 'Current_A', unit: 'A', base: 8.5, range: 3 },
  { name: 'Temp_02', unit: '°C', base: 52, range: 18 },
]

type Quality = 'Good' | 'Suspect' | 'Bad'
type CleanMethod = 'Clipped' | 'Interpolated' | '—'
type AnomalyFlag = 'OutOfRange' | 'Spike' | 'Missing' | null

interface MockReading {
  ts: string
  signal: string
  rawValue: number
  unit: string
  quality: Quality
  flag: AnomalyFlag
  cleanedValue: number
  method: CleanMethod
  anomaly: boolean
}

function generateReadings(modelId: string, baseTime: string): MockReading[] {
  const seed = modelId.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const rand = seedRand(seed)
  const base = new Date(baseTime).getTime()

  return SIGNALS.map((sig, i) => {
    const r1 = rand()
    const r2 = rand()
    const r3 = rand()
    const r4 = rand()
    const ts = new Date(base - i * 80_000).toISOString()
    const rawValue = parseFloat(
      (sig.base + (r1 - 0.5) * sig.range * 2).toFixed(2),
    )

    const isAnomaly = r2 < 0.28
    const flagOptions: AnomalyFlag[] = ['OutOfRange', 'Spike', 'Missing']
    const flag: AnomalyFlag = isAnomaly
      ? (flagOptions[Math.floor(r3 * 3)] ?? 'OutOfRange')
      : null
    const quality: Quality = isAnomaly
      ? r2 < 0.12
        ? 'Bad'
        : 'Suspect'
      : 'Good'
    const cleanedValue = isAnomaly
      ? parseFloat((sig.base + (r4 - 0.5) * sig.range * 0.4).toFixed(2))
      : rawValue
    const method: CleanMethod = isAnomaly
      ? flag === 'Missing'
        ? 'Interpolated'
        : 'Clipped'
      : '—'

    return {
      ts,
      signal: sig.name,
      rawValue,
      unit: sig.unit,
      quality,
      flag,
      cleanedValue,
      method,
      anomaly: isAnomaly,
    }
  })
}

export default function ModelDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const workspaces = useAtomValue(workspacesAtom)
  const [model, setModel] = useState<AIModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [isToggling, setIsToggling] = useState(false)

  async function handleToggleDeploy(next: 'running' | 'stopped') {
    if (!model) return
    setIsToggling(true)
    try {
      await updateModel(model.id, { deployStatus: next })
      setModel(prev =>
        prev?.data
          ? { ...prev, data: { ...prev.data, deployStatus: next } }
          : prev,
      )
      toast.success(
        next === 'running' ? `${model.name} starting` : `${model.name} stopped`,
      )
    } catch {
      toast.error('Failed to update deploy status')
    } finally {
      setIsToggling(false)
    }
  }

  useEffect(() => {
    if (workspaces.length === 0) return

    let ignore = false

    const fetchModelDetail = async () => {
      setLoading(true)

      try {
        const results = await Promise.all(
          workspaces.map(ws => getModels(ws.id)),
        )

        if (!ignore) {
          const found = results.flat().find(m => m.id === id) ?? null
          setModel(found)
          setLoading(false)
        }
      } catch {
        if (!ignore) {
          setModel(null)
          setLoading(false)
        }
      }
    }

    void fetchModelDetail()

    return () => {
      ignore = true
    }
  }, [id, workspaces])

  const readings = useMemo(
    () => (model ? generateReadings(model.id, model.updatedAt) : []),
    [model],
  )

  if (loading) {
    return (
      <div className="flex-1 overflow-auto p-6 md:p-8">
        <Skeleton className="mb-6 h-5 w-28" />
        <Skeleton className="mb-4 h-10 w-72" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="mt-6 h-10 w-64 rounded-lg" />
        <Skeleton className="mt-3 h-64 rounded-lg" />
      </div>
    )
  }

  if (!model) {
    return (
      <div className="flex-1 overflow-auto p-6 md:p-8">
        <Link
          href="/models/views"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <Box className="h-10 w-10 opacity-30" />
          <p className="text-base font-medium">Model not found</p>
        </div>
      </div>
    )
  }

  const deployKey = (model.data?.deployStatus ??
    'stopped') as keyof typeof DEPLOY_CONFIG
  // Monitoring is forced offline when the model isn't deployed —
  // a stopped/failed model can never show a live monitoring state.
  const prodKey = effectiveProdStatus(model)
  const monitoringDisabled = deployKey === 'stopped' || deployKey === 'error'
  const deploy = DEPLOY_CONFIG[deployKey] ?? DEPLOY_CONFIG.stopped
  const prod = PROD_CONFIG[prodKey]
  const DeployIcon = deploy.icon
  const ProdIcon = prod.icon

  const nodeName = model.nodes
    ? ((model.nodes.data as { name?: string }).name ?? '—')
    : '—'
  const plantName = model.nodes?.plan?.name ?? '—'

  const logs = [...(model.data?.logs ?? [])].reverse()
  const anomalyCount = readings.filter(r => r.anomaly).length

  return (
    <div className="flex-1 overflow-auto bg-background p-6 md:p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Back */}
        <Link
          href="/models/views"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Models
        </Link>

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Box className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold text-foreground">
                  {model.name}
                </h1>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    deploy.cls,
                  )}
                >
                  <DeployIcon className="h-3 w-3" />
                  {deploy.label}
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    prod.cls,
                    monitoringDisabled && 'opacity-50',
                  )}
                >
                  <ProdIcon className="h-3 w-3" />
                  {prod.label}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {plantName} · {nodeName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {deployKey === 'running' || deployKey === 'initializing' ? (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={isToggling || deployKey === 'initializing'}
                onClick={() => void handleToggleDeploy('stopped')}
              >
                <StopCircle className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={isToggling}
                onClick={() => void handleToggleDeploy('running')}
              >
                <Play className="h-4 w-4" />
                Start
              </Button>
            )}
            <Button variant="outline" size="sm" className="gap-1.5">
              <RefreshCw className="h-4 w-4" />
              Retrain
            </Button>
            <Button variant="ghost" size="icon" className="h-9 w-9">
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground">
                Deploy
              </p>
              <div
                className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                  deploy.cls,
                )}
              >
                <DeployIcon className="h-3.5 w-3.5" />
                {deploy.label}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground">
                Production
              </p>
              <div
                className={cn(
                  'mt-2 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold',
                  prod.cls,
                  monitoringDisabled && 'opacity-50',
                )}
              >
                <ProdIcon className="h-3.5 w-3.5" />
                {prod.label}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card">
            <CardContent className="pt-5">
              <p className="text-xs font-medium text-muted-foreground">
                Deployed On
              </p>
              <div className="mt-2 flex items-center gap-1.5">
                <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate text-sm font-semibold text-foreground">
                  {nodeName}
                </span>
              </div>
              {plantName !== '—' && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {plantName}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="logs" className="flex w-full flex-col">
          {/* หุ้มด้วย div เพื่อบังคับ Layout ไม่ให้โดนยืดและรองรับ Scroll บนมือถือ */}
          <div className="mb-4 flex w-full items-center overflow-x-auto pb-1">
            <TabsList className="inline-flex h-10 w-max items-center justify-start p-1">
              <TabsTrigger
                value="logs"
                className="flex items-center gap-2 px-4"
              >
                <Terminal className="h-4 w-4 shrink-0" />
                <span>Logs</span>
                {logs.length > 0 && (
                  <span className="ml-1 flex h-4 items-center justify-center rounded-full bg-muted-foreground/20 px-2 text-[10px] font-semibold tabular-nums text-foreground">
                    {logs.length}
                  </span>
                )}
              </TabsTrigger>

              <TabsTrigger
                value="input"
                className="flex items-center gap-2 px-4"
              >
                <Database className="h-4 w-4 shrink-0" />
                <span>Input Data</span>
              </TabsTrigger>

              <TabsTrigger
                value="cleansing"
                className="flex items-center gap-2 px-4"
              >
                <Sparkles className="h-4 w-4 shrink-0" />
                <span>Data Cleansing</span>
                {anomalyCount > 0 && (
                  <span className="ml-1 flex h-4 items-center justify-center rounded-full bg-amber-500/15 px-2 text-[10px] font-semibold tabular-nums text-amber-500">
                    {anomalyCount}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ── Logs ── */}
          <TabsContent value="logs" className="mt-0">
            <Card className="border-border bg-card">
              <ScrollArea className="h-96 rounded-lg">
                {logs.length === 0 ? (
                  <div className="flex h-96 items-center justify-center text-sm text-muted-foreground">
                    No log entries yet
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {logs.map((entry, i) => (
                      <div
                        key={i}
                        className={cn(
                          'flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30',
                          entry.level === 'error' &&
                            'border-l-2 border-red-500/50 pl-3',
                        )}
                      >
                        <span className="mt-0.5 min-w-[6rem] shrink-0 font-mono text-[11px] text-muted-foreground/60">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span
                          className={cn(
                            'w-12 shrink-0 font-mono text-[11px] font-semibold uppercase',
                            LOG_CLS[entry.level],
                          )}
                        >
                          {entry.level}
                        </span>
                        <span className="break-all font-mono text-[11px] text-foreground/80">
                          {entry.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </Card>
          </TabsContent>

          {/* ── Input Data ── */}
          <TabsContent value="input" className="mt-4">
            <Card className="overflow-hidden border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Signal</TableHead>
                    <TableHead className="text-right">Raw Value</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Quality</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-border">
                  {readings.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                        {new Date(row.ts).toLocaleTimeString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-foreground">
                        {row.signal}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-foreground">
                        {row.rawValue}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.unit}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
                            row.quality === 'Good' &&
                              'bg-emerald-500/10 text-emerald-500',
                            row.quality === 'Suspect' &&
                              'bg-amber-500/10 text-amber-500',
                            row.quality === 'Bad' &&
                              'bg-red-500/10 text-red-500',
                          )}
                        >
                          {row.quality}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* ── Data Cleansing ── */}
          <TabsContent value="cleansing" className="mt-4 space-y-3">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
              <Sparkles className="h-4 w-4 text-amber-500" />
              <p className="text-sm text-foreground">
                <span className="font-semibold text-amber-500">
                  {anomalyCount}
                </span>{' '}
                of <span className="font-semibold">{readings.length}</span>{' '}
                signals cleaned this cycle
              </p>
            </div>

            <Card className="overflow-hidden border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6" />
                    <TableHead>Signal</TableHead>
                    <TableHead className="text-right">Raw</TableHead>
                    <TableHead>Flag</TableHead>
                    <TableHead className="text-right">Cleaned</TableHead>
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {readings.map((row, i) => (
                    <TableRow
                      key={i}
                      className={row.anomaly ? 'bg-amber-500/0.03' : undefined}
                    >
                      <TableCell>
                        <span
                          className={cn(
                            'block h-2 w-2 rounded-full',
                            row.anomaly ? 'bg-amber-500' : 'bg-emerald-500',
                          )}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-foreground">
                        {row.signal}
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono text-xs tabular-nums',
                          row.anomaly
                            ? 'text-amber-500 line-through opacity-70'
                            : 'text-foreground',
                        )}
                      >
                        {row.rawValue} {row.unit}
                      </TableCell>
                      <TableCell>
                        {row.flag ? (
                          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-amber-500/10 text-amber-500">
                            {row.flag}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground/40">
                            —
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-foreground">
                        {row.cleanedValue} {row.unit}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.method}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
