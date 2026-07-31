'use client'

import { CheckCircle2, Loader2, MinusCircle, Plug, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SavedDataSource } from '@/lib/mock-data-sources'
import {
  deriveConnectionComponents,
  type ComponentStatus,
} from '@/lib/connection-status'
import type { SourceVerifyStatus } from '@/hooks/dataset/use-source-connection-verify'

const ROWS: {
  key: keyof ReturnType<typeof deriveConnectionComponents>
  label: string
}[] = [
  { key: 'connection', label: 'Connection' },
  { key: 'piServer', label: 'PI Data Server' },
  { key: 'assetServer', label: 'Asset Server' },
]

function StatusIcon({ status }: { status: ComponentStatus }) {
  if (status === 'ok')
    return (
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
    )
  if (status === 'error')
    return <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
  if (status === 'pending')
    return (
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
    )
  return (
    <MinusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
  )
}

function statusLabel(status: ComponentStatus): string {
  switch (status) {
    case 'ok':
      return 'OK'
    case 'error':
      return 'Failed'
    case 'pending':
      return 'Checking…'
    case 'unverified':
      return 'Not verified'
    default:
      return 'Not tested'
  }
}

interface Props {
  sources: SavedDataSource[]
  statusFor: (id: string) => SourceVerifyStatus
  onVerify: (id: string) => void
  disabled?: boolean
}

/**
 * Verify-Connection panel (P8 / Step 2). One card per selected PI source with a
 * Verify action and three status rows. Connection + PI Data Server reflect the
 * single F6 test result; Asset Server is always "Not verified" because the
 * backend test never checks it (no fabricated status). Status colors mirror the
 * add-connection dialog's test result (emerald ok / destructive fail).
 */
export function ConnectionVerifyPanel({
  sources,
  statusFor,
  onVerify,
  disabled,
}: Props) {
  if (sources.length === 0) return null

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-foreground">Verify Connection</p>
      {sources.map(source => {
        const st = statusFor(source.id)
        const comp = deriveConnectionComponents(st.state)
        const testing = st.state === 'testing'

        return (
          <div
            key={source.id}
            className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Plug className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {source.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {source.host}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-fit shrink-0"
                onClick={() => onVerify(source.id)}
                disabled={disabled || testing}
              >
                {testing ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    Verifying…
                  </>
                ) : (
                  <>
                    <Plug className="mr-2 h-3.5 w-3.5" />
                    {st.state === 'idle' ? 'Verify' : 'Re-verify'}
                  </>
                )}
              </Button>
            </div>

            <div className="space-y-1.5">
              {ROWS.map(row => {
                const status = comp[row.key]
                return (
                  <div
                    key={row.key}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <StatusIcon status={status} />
                      <span className="text-foreground">{row.label}</span>
                    </div>
                    <span
                      className={cn(
                        'text-muted-foreground',
                        status === 'ok' &&
                          'text-emerald-600 dark:text-emerald-400',
                        status === 'error' && 'text-destructive',
                      )}
                    >
                      {statusLabel(status)}
                    </span>
                  </div>
                )
              })}
            </div>

            {st.message && (
              <div
                className={cn(
                  'flex items-start gap-2 rounded-md p-2.5 text-xs',
                  st.state === 'ok' &&
                    'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  st.state === 'error' && 'bg-destructive/10 text-destructive',
                )}
              >
                {st.state === 'ok' ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                )}
                <span>{st.message}</span>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              The Asset (AF) server isn&apos;t checked by this connection test.
            </p>
          </div>
        )
      })}
    </div>
  )
}
