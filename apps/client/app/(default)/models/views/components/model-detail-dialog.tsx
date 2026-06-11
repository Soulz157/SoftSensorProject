'use client'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Power,
  RefreshCw,
  StopCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AIModel } from '@/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'

const DEPLOY_MAP = {
  running: {
    label: 'Running',
    icon: Activity,
    cls: 'bg-emerald-500/15 text-emerald-500',
  },
  stopped: {
    label: 'Stopped',
    icon: StopCircle,
    cls: 'bg-zinc-500/15 text-zinc-400',
  },
  failed: {
    label: 'Failed',
    icon: AlertCircle,
    cls: 'bg-red-500/15 text-red-500',
  },
  initializing: {
    label: 'Initializing',
    icon: RefreshCw,
    cls: 'bg-blue-500/15 text-blue-400',
  },
} as const

const PROD_MAP = {
  normal: {
    label: 'Normal',
    icon: Activity,
    cls: 'bg-emerald-500/15 text-emerald-500',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    cls: 'bg-amber-500/15 text-amber-500',
  },
  alert: {
    label: 'Alert',
    icon: AlertCircle,
    cls: 'bg-red-500/15 text-red-500',
  },
  offline: {
    label: 'Offline',
    icon: Power,
    cls: 'bg-zinc-500/15 text-zinc-400',
  },
} as const

type DS = keyof typeof DEPLOY_MAP
type PS = keyof typeof PROD_MAP

const LOG_CLS = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
} as const

interface Props {
  model: AIModel | null
  open: boolean
  onClose: () => void
}

export function ModelDetailDialog({ model, open, onClose }: Props) {
  const router = useRouter()

  if (!model) return null

  const ds =
    DEPLOY_MAP[(model.data?.deployStatus ?? 'stopped') as DS] ??
    DEPLOY_MAP.stopped
  const ps =
    PROD_MAP[(model.data?.prodStatus ?? 'normal') as PS] ?? PROD_MAP.normal
  const DIcon = ds.icon
  const PIcon = ps.icon

  const recentLogs = [...(model.data?.logs ?? [])].reverse().slice(0, 5)
  const nodeName = model.nodes
    ? ((model.nodes.data as { name?: string }).name ?? '—')
    : '—'
  const plantName = model.nodes?.plan?.name ?? '—'
  const hasError =
    model.data?.deployStatus === 'failed' || model.data?.prodStatus === 'alert'

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border p-6 pb-4">
          <DialogTitle className="text-lg">{model.name}</DialogTitle>
          <div className="mt-2 flex flex-wrap gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                ds.cls,
              )}
            >
              <DIcon className="h-3 w-3" />
              Deploy: {ds.label}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                ps.cls,
              )}
            >
              <PIcon className="h-3 w-3" />
              Prod: {ps.label}
            </span>
          </div>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Deploy
                </p>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                    ds.cls,
                  )}
                >
                  <DIcon className="h-3 w-3" />
                  {ds.label}
                </span>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Production
                </p>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
                    ps.cls,
                  )}
                >
                  <PIcon className="h-3 w-3" />
                  {ps.label}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assigned To
              </p>
              <p className="font-medium text-foreground">{plantName}</p>
              <p className="text-xs text-muted-foreground">{nodeName}</p>
            </div>

            {hasError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                Model is in error state. Check full logs before proceeding.
              </div>
            )}

            {recentLogs.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Recent Logs
                </p>
                <div className="space-y-1 rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
                  {recentLogs.map((log, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span
                        className={cn(
                          'w-9 shrink-0 font-semibold uppercase',
                          LOG_CLS[log.level as keyof typeof LOG_CLS] ??
                            'text-muted-foreground',
                        )}
                      >
                        {log.level}
                      </span>
                      <span className="flex-1 break-all text-foreground/80">
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No log entries yet.
              </p>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="border-t border-border p-4">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Close
          </Button>
          <Button
            className="flex-1 gap-1.5"
            onClick={() => {
              onClose()
              router.push(`/models/${model.id}`)
            }}
          >
            Open Full Detail
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
