'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { signed, type DemoModel } from '@/lib/landing-demo'
import {
  DEFAULT_TRACE,
  labSamplesBetween,
  pointerPull,
  toPath,
  traceValue,
  valueToY,
  type TraceShape,
} from '@/lib/signal-trace'

const PX_PER_SAMPLE = 6
const SAMPLES_PER_SECOND = 1.2
const LAB_EVERY = 36
const DIAMOND_POOL = 14
const STEP_PX = 4
// Headroom so the chart reads as a calm trend, not a full-height swing.
const CHART_PAD = 0.28
const LINE_PAD = 0.15

/**
 * The one moving thing on the auth pages: a soft-sensor prediction drifting
 * left, with lab samples (diamonds) riding on it — the same marks as the
 * Actual vs Predict chart.
 * - `line` (the auth shell): a background trace that bends gently toward the
 *   pointer anywhere on the page.
 * - `chart`: a trend panel; hovering scrubs a crosshair and reads the value.
 * Draws by mutating SVG attributes in a rAF loop (no React re-render per
 * frame). Reduced motion: drawn once, never drifts, no pull; the chart's
 * hover readout still works because it answers the user.
 */
export function SignalTrace({
  variant = 'chart',
  readout = false,
  model,
  labHover = false,
  className,
  tag = 'RVP-DEMO',
  unit = 'kPa',
  shape = DEFAULT_TRACE,
}: {
  variant?: 'line' | 'chart'
  /** `line` only: show the latest predicted value in mono at bottom-right
   *  (the chart always shows its readout). */
  readout?: boolean
  /** `line` + `readout`: show the model's fit beside the live value
   *  (illustrative landing data). */
  model?: DemoModel
  /** Hovering a lab diamond shows lab vs predicted and the error. */
  labHover?: boolean
  className?: string
  tag?: string
  unit?: string
  shape?: TraceShape
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const diamondsRef = useRef<SVGGElement>(null)
  const crossRef = useRef<SVGGElement>(null)
  const dotRef = useRef<SVGCircleElement>(null)
  const valueRef = useRef<HTMLSpanElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const lastLabRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const box = boxRef.current
    const svg = svgRef.current
    const path = pathRef.current
    const diamonds = diamondsRef.current
    if (!box || !svg || !path || !diamonds) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 0
    let height = 0
    let offset = 400
    let last = performance.now()
    let raf = 0
    let pointer: { x: number; y: number } | null = null
    let pullStrength = 0
    const isLine = variant === 'line'
    // The model panel sits in the bottom-right (md+); keep the line above it.
    let reserveBottom = 0
    const yOf = (v: number) =>
      valueToY(v, height - reserveBottom, shape, isLine ? LINE_PAD : CHART_PAD)

    const formatTime = (minutesAgo: number) => {
      const d = new Date(Date.now() - minutesAgo * 60_000)
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    }

    function draw() {
      if (width === 0 || height === 0 || !path || !diamonds) return

      // Ease the line's pull in and out instead of snapping (line only).
      const near =
        isLine &&
        !reduce.matches &&
        pointer !== null &&
        pointer.y >= -160 &&
        pointer.y <= height + 160
      pullStrength += ((near ? 1 : 0) - pullStrength) * 0.12
      const pull = (x: number, y: number) =>
        pullStrength > 0.001 ? pullStrength * pointerPull(x, y, pointer) : 0

      const pts: { x: number; y: number }[] = []
      for (let x = 0; x <= width + STEP_PX; x += STEP_PX) {
        const y = yOf(traceValue(offset + x / PX_PER_SAMPLE, shape))
        pts.push({ x, y: y + pull(x, y) })
      }
      path.setAttribute('d', toPath(pts))

      const samples = labSamplesBetween(
        offset,
        offset + width / PX_PER_SAMPLE,
        LAB_EVERY,
        shape,
      )
      const nodes = diamonds.children
      let hit: { x: number; y: number; actual: number; p: number } | null = null
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i] as SVGRectElement
        const s = samples[i]
        if (!s) {
          node.setAttribute('visibility', 'hidden')
          continue
        }
        const x = (s.p - offset) * PX_PER_SAMPLE
        const lineY = yOf(traceValue(s.p, shape))
        const y = yOf(s.actual) + pull(x, lineY)
        const isHit =
          labHover &&
          pointer !== null &&
          Math.abs(pointer.x - x) < 16 &&
          Math.abs(pointer.y - y) < 28
        if (isHit) hit = { x, y, actual: s.actual, p: s.p }
        node.setAttribute('visibility', 'visible')
        node.setAttribute('stroke', isHit ? 'var(--primary)' : 'none')
        node.setAttribute('stroke-width', '2')
        node.setAttribute('transform', `translate(${x} ${y}) rotate(45)`)
      }

      const tip = tipRef.current
      if (tip) {
        if (hit) {
          const predicted = traceValue(hit.p, shape)
          tip.textContent = `Lab sample ${hit.actual.toFixed(1)} ${unit}\nPredicted ${predicted.toFixed(1)}, error ${signed(predicted - hit.actual)} ${unit}`
          tip.style.visibility = 'visible'
          const left = Math.min(Math.max(hit.x - 120, 8), width - 248)
          tip.style.transform = `translate(${left}px, ${hit.y - 58}px)`
        } else {
          tip.style.visibility = 'hidden'
        }
      }
      if (isLine) {
        if (readout && valueRef.current) {
          const latest = traceValue(offset + width / PX_PER_SAMPLE, shape)
          valueRef.current.textContent = `${latest.toFixed(1)} ${unit}`
        }
        if (readout && timeRef.current)
          timeRef.current.textContent = 'predicted'
        const lastLab = samples[samples.length - 1]
        if (lastLabRef.current && lastLab) {
          const minutes = Math.max(
            1,
            Math.round(offset + width / PX_PER_SAMPLE - lastLab.p),
          )
          lastLabRef.current.textContent = `${lastLab.actual.toFixed(1)} ${unit}, ${minutes} min ago`
        }
        return
      }

      const hover =
        pointer !== null &&
        pointer.x >= 0 &&
        pointer.x <= width &&
        pointer.y >= 0 &&
        pointer.y <= height
      const x = hover && pointer ? pointer.x : width - 1
      const value = traceValue(offset + x / PX_PER_SAMPLE, shape)
      crossRef.current?.setAttribute('visibility', hover ? 'visible' : 'hidden')
      crossRef.current?.setAttribute('transform', `translate(${x} 0)`)
      dotRef.current?.setAttribute('cy', String(yOf(value)))
      if (valueRef.current) {
        valueRef.current.textContent = `${value.toFixed(1)} ${unit}`
      }
      if (timeRef.current) {
        timeRef.current.textContent = hover
          ? formatTime((width - x) / PX_PER_SAMPLE)
          : 'now'
      }
    }

    const resize = () => {
      const r = box.getBoundingClientRect()
      width = r.width
      height = r.height
      reserveBottom =
        isLine && readout && model && window.innerWidth >= 768 ? 112 : 0
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    }
    resize()
    const ro = new ResizeObserver(() => {
      resize()
      draw()
    })
    ro.observe(box)

    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top }
      if (reduce.matches) draw()
    }
    const onLeave = () => {
      pointer = null
      if (reduce.matches) draw()
    }
    // The line sits behind the card, so it listens on the whole window; the
    // chart only cares about the pointer over itself.
    const moveTarget: Window | HTMLElement = isLine ? window : box
    const leaveTarget: HTMLElement = isLine ? document.documentElement : box
    moveTarget.addEventListener('pointermove', onMove as EventListener, {
      passive: true,
    })
    leaveTarget.addEventListener('pointerleave', onLeave)

    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      offset += dt * SAMPLES_PER_SECOND
      draw()
      raf = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(raf)
      if (reduce.matches) {
        draw()
        return
      }
      last = performance.now()
      raf = requestAnimationFrame(tick)
    }
    start()
    reduce.addEventListener('change', start)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      reduce.removeEventListener('change', start)
      moveTarget.removeEventListener('pointermove', onMove as EventListener)
      leaveTarget.removeEventListener('pointerleave', onLeave)
    }
  }, [variant, readout, model, labHover, unit, shape])

  return (
    <div ref={boxRef} className={cn('relative', className)} aria-hidden>
      <svg ref={svgRef} className="absolute inset-0 size-full overflow-visible">
        {variant === 'chart' && (
          <g stroke="var(--border)" strokeWidth="1">
            <line x1="0" x2="100%" y1="30%" y2="30%" />
            <line x1="0" x2="100%" y1="50%" y2="50%" />
            <line x1="0" x2="100%" y1="70%" y2="70%" />
          </g>
        )}
        <path
          ref={pathRef}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={variant === 'chart' ? 2 : 1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <g ref={diamondsRef} fill="var(--foreground)" fillOpacity="0.85">
          {Array.from({ length: DIAMOND_POOL }, (_, i) => (
            <rect
              key={i}
              x="-3"
              y="-3"
              width="6"
              height="6"
              rx="1"
              visibility="hidden"
            />
          ))}
        </g>
        {variant === 'chart' && (
          <g ref={crossRef} visibility="hidden">
            <line
              y1="0"
              y2="100%"
              stroke="var(--muted-foreground)"
              strokeOpacity="0.5"
              strokeDasharray="3 3"
            />
            <circle
              ref={dotRef}
              r="4"
              cx="0"
              fill="var(--card)"
              stroke="var(--primary)"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>
      {labHover && (
        <div
          ref={tipRef}
          role="status"
          className="pointer-events-none absolute top-0 left-0 w-60 rounded-md bg-popover px-2.5 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-line text-popover-foreground shadow-[0_4px_24px_rgba(0,0,0,0.08)] ring-1 ring-foreground/10 dark:shadow-[0_4px_24px_rgba(0,0,0,0.32)]"
          style={{ visibility: 'hidden' }}
        />
      )}
      {variant === 'line' && readout && model ? (
        <dl className="absolute right-6 bottom-6 hidden min-w-56 grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs md:right-10 md:bottom-8 md:grid">
          <dt className="text-muted-foreground">{model.target}</dt>
          <dd className="text-right text-muted-foreground">
            {model.algorithm} {model.version}
          </dd>
          <dt className="text-muted-foreground">Predicted</dt>
          <dd ref={valueRef} className="text-right text-sm text-foreground" />
          <dt className="text-muted-foreground">Last lab</dt>
          <dd className="text-right text-foreground">
            <span ref={lastLabRef} />
          </dd>
          <dt className="text-muted-foreground">Fit</dt>
          <dd className="text-right text-foreground">
            R² {model.r2.toFixed(2)}, RMSE {model.rmse.toFixed(2)} {model.unit}
          </dd>
        </dl>
      ) : (
        (variant === 'chart' || readout) && (
          <div className="absolute right-6 bottom-6 hidden items-baseline gap-3 font-mono text-[13px] md:right-10 md:bottom-8 md:flex">
            <span className="text-muted-foreground">{tag}</span>
            <span ref={valueRef} className="text-foreground" />
            <span ref={timeRef} className="text-muted-foreground" />
          </div>
        )
      )}
    </div>
  )
}
