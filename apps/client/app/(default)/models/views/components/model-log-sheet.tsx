'use client'
import { AlertCircle, Info, Terminal, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AIModel } from '@/types'
import { Badge } from '@/components/ui/badge'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useWindowLogs } from '@/hooks/model/use-window-logs'
import type { WindowLogContext } from '@/services/inference-window'
import {
  describeEmptyWindowLog,
  describeLogTruncation,
} from '@/lib/window-log-state'

const LEVEL_MAP = {
  info: { icon: Info, cls: 'text-blue-400', bg: 'bg-blue-500/10' },
  warn: { icon: TriangleAlert, cls: 'text-amber-400', bg: 'bg-amber-500/10' },
  error: { icon: AlertCircle, cls: 'text-red-400', bg: 'bg-red-500/10' },
} as const

/** DESIGN_SYSTEM.md §5 "Model run status (badge)" — a window IS a run, so
 *  it takes that table rather than inventing a sixth status palette. */
const STATUS_BADGE = {
  SUCCEEDED: 'bg-emerald-500/15 text-emerald-500',
  RUNNING: 'bg-blue-500/15 text-blue-400',
  FAILED: 'bg-red-500/15 text-red-500',
  SKIPPED: 'bg-zinc-500/15 text-zinc-400',
  PENDING: 'bg-zinc-500/15 text-zinc-400',
} as const

interface Props {
  model: AIModel | null
  open: boolean
  onClose: () => void
}

/**
 * MODEL-SERVE-001-T10. The PEEK half of the container-log read: the model's
 * most recent inference window, its facts, and its last lines. The full
 * range lives on `models/[id]`'s Logs tab, and both resolve through
 * `useWindowLogs` and the SAME endpoint so the two screens cannot disagree
 * about one model.
 *
 * This used to render `model.data.logs` — a `Model.data` JSON array that is
 * initialized `[]` and whose only writer (`appendLogService`) has no client
 * caller, so it was empty for every model, forever, and said "No logs yet."
 * while the container's real output was being written to
 * `InferenceWindowLog` and discarded unread.
 */
export function ModelLogSheet({ model, open, onClose }: Props) {
  // `latest` is resolved server-side: this sheet holds a Model and has no
  // window id to send.
  const { logs, loading, error } = useWindowLogs(
    open && model ? model.id : null,
    'latest',
  )

  const truncationNote = logs
    ? describeLogTruncation(logs.truncated, logs.omittedCount)
    : null

  return (
    <Sheet open={open} onOpenChange={o => !o && onClose()}>
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            {model?.name} — Console
          </SheetTitle>
        </SheetHeader>

        {logs && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge
              variant="outline"
              className={cn(
                'border-0 text-xs font-medium',
                STATUS_BADGE[logs.window.status],
              )}
            >
              {logs.window.status}
            </Badge>
            {/* T11/V10/V11: same facts, same wording as window-logs-tab.tsx's
                metadata row — one vocabulary for a window's own numbers
                across both surfaces, not a second one invented here. */}
            <span>
              Most recent window ·{' '}
              {new Date(logs.window.windowStart).toLocaleString()} –{' '}
              {new Date(logs.window.windowEnd).toLocaleTimeString()}
            </span>
            {logs.window.inputRows !== null && (
              <span>{logs.window.inputRows.toLocaleString()} input rows</span>
            )}
            {logs.window.missingPct !== null && (
              <span>{(logs.window.missingPct * 100).toFixed(1)}% missing</span>
            )}
          </div>
        )}

        <div className="mt-2 flex-1 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs">
          {loading ? (
            <p className="py-10 text-center text-muted-foreground">
              Loading container output…
            </p>
          ) : error ? (
            <p className="py-10 text-center text-muted-foreground">
              Could not load container output: {error}
            </p>
          ) : !logs ? (
            <p className="py-10 text-center font-sans text-muted-foreground">
              This model has no inference windows yet. A window is created once
              its schedule is running.
            </p>
          ) : logs.lines.length === 0 ? (
            <EmptyWindow window={logs.window} />
          ) : (
            <>
              {truncationNote && (
                <p className="mb-2 px-2 text-muted-foreground">
                  {truncationNote}
                </p>
              )}
              {logs.lines.map(line => {
                // `level` is an unconstrained Prisma String, not an enum:
                // fall back rather than throw on an unexpected value.
                const {
                  icon: Icon,
                  cls,
                  bg,
                } = LEVEL_MAP[line.level] ?? LEVEL_MAP.info
                return (
                  <div
                    key={line.id}
                    className={cn(
                      'mb-1 flex items-start gap-2 rounded px-2 py-1',
                      bg,
                    )}
                  >
                    <Icon className={cn('mt-0.5 h-3 w-3 shrink-0', cls)} />
                    <span className="flex-1 break-all text-foreground">
                      {line.message}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {new Date(line.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Four zero-line causes, four sentences — see `lib/window-log-state.ts`
 *  for why "the container printed nothing" is not one of them. */
function EmptyWindow({ window }: { window: WindowLogContext }) {
  const { title, detail } = describeEmptyWindowLog(window)
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center font-sans">
      <Terminal className="h-8 w-8 text-muted-foreground opacity-30" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}
