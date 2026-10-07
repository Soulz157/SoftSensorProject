'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  DEMO_MODEL,
  DEMO_PSI_WARN,
  DEMO_TAGS,
  psiStatusOf,
  sparkPoints,
  tagHistory,
  tagValueAt,
} from '@/lib/landing-demo'
import {
  MONITORING_STATUS_CLASS,
  MONITORING_STATUS_LABEL,
} from '@/lib/drift-status-style'
import { SignalTrace } from '@/components/auth/signal-trace'

const HEADER_H = 28
const ROW_H = 60
const BODY_H = DEMO_TAGS.length * ROW_H
const SPARK_W = 48
const SPARK_H = 16

/**
 * Direction C: live input tags, each with its input drift (PSI, graded and
 * coloured exactly like the app's Drift badge), feeding a trained model whose
 * output is the prediction line. Hovering a tag highlights its path. Values
 * tick once a second; reduced motion holds them still. Illustrative data only.
 */
export function TagFeed() {
  const [step, setStep] = useState(0)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (reduce.matches) return
    const id = window.setInterval(() => setStep(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  const m = DEMO_MODEL
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.15fr)_48px_minmax(0,1fr)]">
        <div>
          <div
            className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-3 border-b border-border pb-2 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_48px_auto_auto]"
            style={{ height: HEADER_H }}
          >
            <span className="whitespace-nowrap">Input tag</span>
            <span className="hidden sm:block">Trend</span>
            <span className="text-right">Value</span>
            <span className="w-28 pr-3 text-right whitespace-nowrap">
              Drift (PSI)
            </span>
          </div>
          <ul>
            {DEMO_TAGS.map((t, i) => (
              <li
                key={t.name}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                className={cn(
                  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-border transition-colors last:border-b-0 sm:grid-cols-[minmax(0,1fr)_48px_auto_auto]',
                  active === i && 'bg-muted/60',
                )}
                style={{ height: ROW_H }}
              >
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[13px] text-foreground">
                    {t.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {t.description}
                  </span>
                </span>
                <svg
                  width={SPARK_W}
                  height={SPARK_H}
                  className="hidden overflow-visible sm:block"
                  aria-hidden
                >
                  <polyline
                    points={sparkPoints(tagHistory(t, step), SPARK_W, SPARK_H)}
                    fill="none"
                    stroke={
                      active === i
                        ? 'var(--primary)'
                        : 'var(--muted-foreground)'
                    }
                    strokeWidth="1.25"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-right font-mono text-[13px] whitespace-nowrap text-foreground tabular-nums">
                  {tagValueAt(t, step).toFixed(t.digits)}
                  {t.unit && (
                    <span className="text-muted-foreground"> {t.unit}</span>
                  )}
                </span>
                <span className="flex w-28 items-center justify-end gap-2 pr-3">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {t.psi.toFixed(2)}
                  </span>
                  <span
                    className={cn(
                      'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium',
                      MONITORING_STATUS_CLASS[psiStatusOf(t.psi)],
                    )}
                  >
                    {MONITORING_STATUS_LABEL[psiStatusOf(t.psi)]}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <svg
          className="hidden w-full sm:block"
          style={{ marginTop: HEADER_H, height: BODY_H }}
          viewBox={`0 0 100 ${BODY_H}`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {DEMO_TAGS.map((t, i) => {
            const y = ROW_H * i + ROW_H / 2
            const mid = BODY_H / 2
            return (
              <path
                key={t.name}
                d={`M0 ${y} C 55 ${y}, 45 ${mid}, 100 ${mid}`}
                fill="none"
                stroke={active === i ? 'var(--primary)' : 'var(--border)'}
                strokeWidth={active === i ? 2 : 1.25}
                vectorEffect="non-scaling-stroke"
                className="transition-[stroke]"
              />
            )
          })}
        </svg>

        {/* Phones: a strip under the table. sm+: beside the connectors
            (sm:mt-7 = HEADER_H, sm:h-[240px] = BODY_H). */}
        <div className="relative mt-3 h-24 sm:mt-7 sm:h-[240px]">
          <div className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-md bg-card px-2 py-1 font-mono text-xs ring-1 ring-foreground/10">
            {m.algorithm} {m.version}
          </div>
          <SignalTrace
            variant="line"
            labHover
            className="absolute inset-y-0 right-0 left-[5.5rem]"
          />
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 font-mono text-xs">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Predicts</dt>
          <dd>
            {m.target} ({m.unit})
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Fit on held-out lab samples</dt>
          <dd>
            R² {m.r2.toFixed(2)}, RMSE {m.rmse.toFixed(2)} {m.unit}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Input drift</dt>
          <dd>
            {DEMO_TAGS.filter(t => t.psi >= DEMO_PSI_WARN).length} of{' '}
            {DEMO_TAGS.length} tags at PSI ≥ {DEMO_PSI_WARN.toFixed(2)}
          </dd>
        </div>
      </dl>
    </div>
  )
}
