'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Timer } from 'lucide-react'
import {
  breakdownRuntime,
  estimateRuntimeSeconds,
  formatDuration,
  SUPERLINEAR,
  type RuntimeInput,
} from '@/lib/model/estimate-runtime'

interface Props extends RuntimeInput {
  status: 'idle' | 'training' | 'done' | 'error'
  progress: number
}

const SEGMENT = [
  'bg-primary',
  'bg-sky-500',
  'bg-violet-500',
  'bg-teal-500',
  'bg-rose-500',
  'bg-fuchsia-500',
]

export function RuntimeEstimate({ status, progress, ...input }: Props) {
  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef<number | null>(null)
  const shares = breakdownRuntime(input)
  const top = shares[0]!
  const dominates = top && shares.length > 1 && top.pct >= 55
  const stacked = shares.length > 2

  useEffect(() => {
    if (status !== 'training') return
    startRef.current = Date.now()
    setElapsed(0)
    const id = setInterval(() => {
      setElapsed((Date.now() - (startRef.current ?? Date.now())) / 1000)
    }, 1000)
    return () => clearInterval(id)
  }, [status])

  const est = estimateRuntimeSeconds(input)
  const low = est * 0.6
  const high = est * 2
  const heavy = est > 900 // 15 min

  // ETA only becomes meaningful once there is real progress to extrapolate from
  const eta =
    status === 'training' && progress > 5
      ? (elapsed * (100 - progress)) / progress
      : null

  const live = status === 'training' || status === 'done'

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">
          {live ? 'Training runtime' : 'Estimated runtime'}
        </span>
        <span className="font-medium tabular-nums">
          {live
            ? formatDuration(elapsed)
            : `${formatDuration(low)} – ${formatDuration(high)}`}
        </span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full transition-all duration-500 ${
            heavy ? 'bg-amber-500' : 'bg-primary'
          }`}
          style={{
            width: live
              ? `${Math.min(progress, 100)}%`
              : `${Math.min((est / 1800) * 100, 100)}%`,
          }}
        />
      </div>

      {!live && shares.length > 0 && (
        <div className="space-y-2 pt-3 border-t border-border/50">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Runtime by algorithm
          </p>

          {/* Stacked contribution bar */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-secondary">
            {shares.map((s, i) => (
              <div
                key={s.id}
                title={`${s.label} — ${formatDuration(s.seconds)}`}
                className={`h-full ${SEGMENT[i % SEGMENT.length]} ${
                  i > 0 ? 'border-l border-background' : ''
                }`}
                style={{ width: `${s.pct}%` }}
              />
            ))}
          </div>

          {/* Top contributors */}
          <ul className="space-y-1">
            {shares.slice(0, 3).map((s, i) => (
              <li key={s.id} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEGMENT[i % SEGMENT.length]}`}
                />
                <span className="flex-1 truncate text-muted-foreground">
                  {s.label}
                  {SUPERLINEAR.has(s.id) && (
                    <span className="ml-1 text-amber-600 dark:text-amber-400">
                      scales poorly with row count
                    </span>
                  )}
                </span>
                <span className="tabular-nums font-medium">
                  {formatDuration(s.seconds)}
                </span>
              </li>
            ))}
            {shares.length > 3 && (
              <li className="pl-3.5 text-[10px] text-muted-foreground">
                + {shares.length - 3} more ·{' '}
                {formatDuration(
                  shares.slice(3).reduce((sum, s) => sum + s.seconds, 0),
                )}
              </li>
            )}
          </ul>

          {/* The actionable line */}
          {(dominates || stacked || input.findBestParams) && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] leading-relaxed text-amber-700 ring-1 ring-amber-500/20 dark:text-amber-400">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
              <span>
                {input.findBestModel
                  ? `Find Best Model trains all ${shares.length} algorithms — turning it off and keeping ${top.label} cuts the run to about ${formatDuration(top.seconds)}.`
                  : dominates
                    ? `${top.label} accounts for ${top.pct.toFixed(0)}% of the estimate — dropping it saves roughly ${formatDuration(top.seconds)}.`
                    : stacked
                      ? `${shares.length} algorithms run sequentially, so runtime is the sum, not the max. Trim the list to shorten the run.`
                      : `Find Best Parameters multiplies runtime by roughly 10× — turn it off for a first pass.`}
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
