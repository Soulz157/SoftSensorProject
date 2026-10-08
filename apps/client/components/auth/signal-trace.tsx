'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { signed, type DemoModel } from '@/lib/landing-demo'
import {
  DEFAULT_TRACE,
  actualValue,
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
/** How far into the box a lead-in wire meets the line. */
const LEAD_SPAN = 40
/** `hourly`: dashed prediction (same as the KPI chart). */
const DASH = '6 4'
const DASH_PERIOD = 10
/** `hourly`: a lab sample is every 6 hours, so an hour is a sixth of that. */
const HOUR_EVERY = LAB_EVERY / 6
/** Enough dots for a ~1700px-wide line at HOUR_EVERY * PX_PER_SAMPLE apart. */
const HOUR_DOT_POOL = 48

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
  leadIn = 0,
  hourly = false,
  actual = false,
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
  /** `line` only: px left of the box where a wire starts at mid-height and
   *  bends into the live line (the landing model chip's output pin). */
  leadIn?: number
  /** `line` only: draw the prediction dashed with a dot per hourly
   *  prediction — the landing KPI chart's language. */
  hourly?: boolean
  /** Draw the actual value as a solid line (lab samples sit on it) and the
   *  prediction dashed, with a small legend on the chart — the auth pages. */
  actual?: boolean
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)
  const leadRef = useRef<SVGPathElement>(null)
  const hourDotsRef = useRef<SVGGElement>(null)
  const actualRef = useRef<SVGPathElement>(null)
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
    const lead = isLine && leadIn > 0 ? leadRef.current : null
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

      // With a lead-in wire, the line proper starts LEAD_SPAN px in; the
      // wire covers the rest so a fast-moving value never makes it kink.
      const startX = lead ? LEAD_SPAN : 0
      const pts: { x: number; y: number }[] = []
      for (let x = startX; x <= width + STEP_PX; x += STEP_PX) {
        const y = yOf(traceValue(offset + x / PX_PER_SAMPLE, shape))
        pts.push({ x, y: y + pull(x, y) })
      }
      path.setAttribute('d', toPath(pts))
      if (hourly || actual) {
        // Dashes ride with the data as it drifts left, not fixed to the box.
        path.setAttribute(
          'stroke-dashoffset',
          ((offset * PX_PER_SAMPLE) % DASH_PERIOD).toFixed(1),
        )
      }
      const actualPath = actualRef.current
      if (actual && actualPath) {
        const truth: { x: number; y: number }[] = []
        for (let x = startX; x <= width + STEP_PX; x += STEP_PX) {
          const p = offset + x / PX_PER_SAMPLE
          const y = yOf(actualValue(p, LAB_EVERY, shape))
          // Same pull as the prediction here, so the two bend together.
          truth.push({ x, y: y + pull(x, yOf(traceValue(p, shape))) })
        }
        actualPath.setAttribute('d', toPath(truth))
      }
      const hourDots = hourDotsRef.current
      if (hourly && hourDots) {
        // A dot per hourly prediction, HOUR_EVERY samples apart, so each lab
        // sample (every LAB_EVERY = 6 hours) falls on a dot.
        const first = Math.ceil((offset + startX / PX_PER_SAMPLE) / HOUR_EVERY)
        const dots = hourDots.children
        for (let i = 0; i < dots.length; i++) {
          const dot = dots[i] as SVGCircleElement
          const p = (first + i) * HOUR_EVERY
          const x = (p - offset) * PX_PER_SAMPLE
          if (x > width) {
            dot.setAttribute('visibility', 'hidden')
            continue
          }
          const y = yOf(traceValue(p, shape))
          dot.setAttribute('visibility', 'visible')
          dot.setAttribute('cx', x.toFixed(1))
          dot.setAttribute('cy', (y + pull(x, y)).toFixed(1))
        }
      }
      const [p0, p1] = pts
      if (lead && p0 && p1) {
        // Leaves the pin flat, meets the line along its own slope.
        const slope = (p1.y - p0.y) / (p1.x - p0.x)
        const d = (leadIn + p0.x) / 2
        const mid = height / 2
        lead.setAttribute(
          'd',
          `M${-leadIn} ${mid.toFixed(1)} C${(-leadIn + d).toFixed(1)} ${mid.toFixed(1)} ${(p0.x - d).toFixed(1)} ${(p0.y - slope * d).toFixed(1)} ${p0.x.toFixed(1)} ${p0.y.toFixed(1)}`,
        )
      }

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
        // No lab marks over the lead-in wire: the line isn't drawn there.
        if (!s || (lead && (s.p - offset) * PX_PER_SAMPLE < LEAD_SPAN)) {
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
  }, [variant, readout, model, labHover, unit, shape, leadIn, hourly, actual])

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
        {actual && (
          <path
            ref={actualRef}
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.75}
            strokeWidth={variant === 'chart' ? 1.75 : 1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {variant === 'line' && leadIn > 0 && (
          <path
            ref={leadRef}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={hourly ? DASH : undefined}
          />
        )}
        <path
          ref={pathRef}
          fill="none"
          stroke="var(--primary)"
          strokeDasharray={hourly || actual ? DASH : undefined}
          strokeWidth={variant === 'chart' ? 2 : hourly || actual ? 1.75 : 1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {hourly && (
          <g
            ref={hourDotsRef}
            fill="var(--primary)"
            stroke="var(--background)"
            strokeWidth="1.5"
          >
            {Array.from({ length: HOUR_DOT_POOL }, (_, i) => (
              <circle key={i} r="2.5" visibility="hidden" />
            ))}
          </g>
        )}
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
      {actual && variant === 'chart' && (
        <div className="absolute top-8 right-10 hidden items-center gap-4 text-xs text-muted-foreground md:flex">
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full bg-foreground/75" />
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-4 border-t-2 border-dashed border-primary" />
            Predicted
          </span>
        </div>
      )}
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
