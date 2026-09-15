'use client'

import { useState } from 'react'
import { Terminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useInferenceWindows } from '@/hooks/model/use-inference-windows'
import { useWindowLogs } from '@/hooks/model/use-window-logs'
import {
  describeEmptyWindowLog,
  describeLogTruncation,
} from '@/lib/window-log-state'

/** DESIGN_SYSTEM.md §5 "Model run status (badge)". Same table the Console
 *  peek uses, so one window cannot read two ways on two screens. */
const STATUS_BADGE = {
  SUCCEEDED: 'bg-emerald-500/15 text-emerald-500',
  RUNNING: 'bg-blue-500/15 text-blue-400',
  FAILED: 'bg-red-500/15 text-red-500',
  SKIPPED: 'bg-zinc-500/15 text-zinc-400',
  PENDING: 'bg-zinc-500/15 text-zinc-400',
  // MODEL-SERVE-001-T20. Neutral zinc, same as SKIPPED — a cancel is an
  // operator action, not an error, so red/amber are not appropriate here.
  CANCELED: 'bg-zinc-500/15 text-zinc-400',
} as const

const LEVEL_CLS = {
  info: 'text-blue-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
} as const

/**
 * MODEL-SERVE-001-T10. The FULL-RANGE half of the container-log read: pick
 * a window, read what its container printed. `models/views`' Console is the
 * peek over the same endpoint and the same hook.
 *
 * This tab used to render `model.data.logs` — a `Model.data` JSON array
 * initialized `[]` whose only writer has no client caller, so it said "No
 * log entries yet" for every model forever while the container's real
 * output went to `InferenceWindowLog` unread.
 *
 * SCHEDULED AND SYNCHRONOUS ARE TWO PLANES AND THIS SHOWS ONE. Nothing
 * here pools `/predict` request logs into the feed; those are
 * `PredictionLog` and belong to Monitoring's Live Predictions section.
 */
export function WindowLogsTab({ modelId }: { modelId: string }) {
  const {
    windows,
    loading: windowsLoading,
    error: windowsError,
  } = useInferenceWindows(modelId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Default to the most recent window — the same thing the Console peek
  // resolves `latest` to, so the two screens open on the same row.
  const activeId = selectedId ?? windows[0]?.id ?? null
  const { logs, loading, error } = useWindowLogs(modelId, activeId)

  const truncationNote = logs
    ? describeLogTruncation(logs.truncated, logs.omittedCount)
    : null

  if (windowsLoading) {
    return (
      <Card className="flex h-96 items-center justify-center border-border bg-card text-sm text-muted-foreground">
        Loading inference windows…
      </Card>
    )
  }

  if (windowsError) {
    return (
      <Card className="flex h-96 items-center justify-center border-border bg-card px-6 text-center text-sm text-muted-foreground">
        Could not load inference windows: {windowsError}
      </Card>
    )
  }

  if (windows.length === 0) {
    return (
      <Card className="flex h-96 flex-col items-center justify-center gap-3 border-border bg-card px-6 text-center">
        <Terminal className="h-10 w-10 text-muted-foreground opacity-30" />
        <p className="text-base font-medium text-foreground">
          No inference windows yet
        </p>
        <p className="max-w-md text-sm text-muted-foreground">
          This tab shows what the scheduled-inference container printed while
          scoring a window. Windows appear once this model has a production
          version and its schedule is running.
        </p>
      </Card>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
      <Card className="border-border bg-card">
        <div className="border-b border-border/60 px-3 py-2">
          <p className="text-xs font-medium text-foreground">Windows</p>
          {/* T02's dispatch order is `desc`, so window time is NOT the order
              these ran. Label it rather than let the reader infer. */}
          <p className="text-[11px] text-muted-foreground">
            Newest window time first — not execution order
          </p>
        </div>
        <ScrollArea className="h-80">
          <div className="divide-y divide-border/40">
            {windows.map(w => (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelectedId(w.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30',
                  w.id === activeId && 'bg-muted/50',
                )}
              >
                <span className="font-mono text-[11px] text-foreground/80">
                  {new Date(w.windowStart).toLocaleString()}
                </span>
                <Badge
                  variant="outline"
                  className={cn(
                    'border-0 text-[10px] font-medium',
                    STATUS_BADGE[w.status],
                  )}
                >
                  {w.status}
                </Badge>
              </button>
            ))}
          </div>
        </ScrollArea>
      </Card>

      <Card className="border-border bg-card">
        {/* MODEL-SERVE-001-T10. The span the user asked for starts at Deploy,
            not at the container. These are the two records that precede it,
            and they are the only thing that can explain a window that never
            spawned a container at all. */}
        {logs && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
            {logs.provenance.version !== null && (
              <span className="font-medium text-foreground/80">
                v{logs.provenance.version}
                {logs.provenance.stage ? ` · ${logs.provenance.stage}` : ''}
              </span>
            )}
            {logs.provenance.promotedBy && (
              <span>
                Promoted by {logs.provenance.promotedBy}
                {logs.provenance.promotedAt &&
                  ` · ${new Date(logs.provenance.promotedAt).toLocaleString()}`}
              </span>
            )}
            {logs.provenance.deployedBy && (
              <span>
                Deployed by {logs.provenance.deployedBy}
                {logs.provenance.deployedAt &&
                  ` · ${new Date(logs.provenance.deployedAt).toLocaleString()}`}
              </span>
            )}
          </div>
        )}
        {logs?.provenance.promotionOverrideReason && (
          // T06: an override that left no trace would be the same as no
          // floor. If this version was promoted below the r2 floor, the
          // reason travels with every window it scored.
          <div className="border-b border-amber-500/20 bg-amber-500/10 px-4 py-2 text-[11px] text-amber-600 dark:text-amber-400">
            Promoted below the r² floor with an override:{' '}
            {logs.provenance.promotionOverrideReason}
          </div>
        )}
        {logs && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
            <span>
              {new Date(logs.window.windowStart).toLocaleString()} –{' '}
              {new Date(logs.window.windowEnd).toLocaleTimeString()}
            </span>
            {logs.window.inputRows !== null && (
              <span>{logs.window.inputRows.toLocaleString()} input rows</span>
            )}
            {logs.window.missingPct !== null && (
              <span>{(logs.window.missingPct * 100).toFixed(1)}% missing</span>
            )}
            {/* `imageDigest` is null even for windows that DID run a
                container (verified live), so it cannot carry this sentence
                on its own — containerId is the discriminator. */}
            <span className="font-mono">
              {logs.window.imageDigest ??
                (logs.window.containerId
                  ? `container ${logs.window.containerId.slice(0, 12)}`
                  : 'no container')}
            </span>
          </div>
        )}

        <ScrollArea className="h-80 rounded-b-lg">
          {loading ? (
            <div className="flex h-80 items-center justify-center text-sm text-muted-foreground">
              Loading container output…
            </div>
          ) : error ? (
            <div className="flex h-80 items-center justify-center px-6 text-center text-sm text-muted-foreground">
              Could not load container output: {error}
            </div>
          ) : !logs ? null : logs.lines.length === 0 ? (
            <EmptyWindow
              title={describeEmptyWindowLog(logs.window).title}
              detail={describeEmptyWindowLog(logs.window).detail}
            />
          ) : (
            <div className="divide-y divide-border/40">
              {truncationNote && (
                <p className="px-4 py-2 text-[11px] text-muted-foreground">
                  {truncationNote}
                </p>
              )}
              {logs.lines.map(line => (
                <div
                  key={line.id}
                  className={cn(
                    'flex items-start gap-3 px-4 py-2.5 hover:bg-muted/30',
                    line.level === 'error' &&
                      'border-l-2 border-red-500/50 pl-3',
                  )}
                >
                  <span className="mt-0.5 min-w-24 shrink-0 font-mono text-[11px] text-muted-foreground/60">
                    {new Date(line.createdAt).toLocaleTimeString()}
                  </span>
                  <span
                    className={cn(
                      'w-12 shrink-0 font-mono text-[11px] font-semibold uppercase',
                      // `InferenceWindowLog.level` is an unconstrained
                      // Prisma String, not an enum like the window status —
                      // an unknown value must not take the tab down.
                      LEVEL_CLS[line.level] ?? LEVEL_CLS.info,
                    )}
                  >
                    {line.level}
                  </span>
                  <span className="break-all font-mono text-[11px] text-foreground/80">
                    {line.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>
    </div>
  )
}

function EmptyWindow({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-80 flex-col items-center justify-center gap-2 px-6 text-center">
      <Terminal className="h-8 w-8 text-muted-foreground opacity-30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
