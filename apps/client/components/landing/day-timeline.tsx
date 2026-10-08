import { cn } from '@/lib/utils'
import { toPath } from '@/lib/signal-trace'
import {
  DEMO_LAB_EVERY_HOURS,
  DEMO_MODEL,
  DEMO_NOW_MINUTE,
  clockLabel,
  dayTimeline,
} from '@/lib/landing-demo'

const W = 1440
const H = 100
/** Headroom so the line and diamonds never touch the frame. */
const PAD = 0.18
const AXIS_HOURS = [24, 18, 12, 6, 0]

/**
 * Sensor vs lab over the last 24 hours: the actual value as a solid line, the
 * soft sensor's hourly prediction as a dashed line with a dot per hour, and
 * the lab's samples (every 6 h) as diamonds on the actual line, each tied to
 * the prediction by its error. `step` moves "now" a minute per tick.
 * Illustrative data only.
 */
export function DayTimeline({ step }: { step: number }) {
  const t = dayTimeline(DEMO_NOW_MINUTE + step)
  const span = t.max - t.min || 1
  const xPct = (minute: number) =>
    ((minute - t.start) / (t.end - t.start)) * 100
  const yPct = (v: number) =>
    (PAD + (1 - (v - t.min) / span) * (1 - 2 * PAD)) * 100
  const line = (pick: (p: (typeof t.points)[number]) => number) =>
    toPath(
      t.points.map(p => ({
        x: (xPct(p.minute) / 100) * W,
        y: (yPct(pick(p)) / 100) * H,
      })),
    )
  const last = t.points[t.points.length - 1]
  const worst = Math.max(...t.lab.map(l => Math.abs(l.actual - l.predicted)))

  return (
    <figure className="mb-8 rounded-lg bg-card p-4 ring-1 ring-foreground/10">
      <figcaption className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs">
        <span className="font-medium text-foreground">Last 24 hours</span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-4 rounded-full bg-foreground/75"
            />
            Actual
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="w-4 border-t-2 border-dashed border-primary"
            />
            Prediction · every hour
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rotate-45 rounded-[1px] bg-foreground/85"
            />
            Lab · every {DEMO_LAB_EVERY_HOURS} h
          </span>
        </span>
      </figcaption>
      <p className="sr-only">
        Over the last 24 hours the soft sensor predicted {DEMO_MODEL.target}{' '}
        every hour ({t.hourly.length} values); the lab measured every{' '}
        {DEMO_LAB_EVERY_HOURS} hours, at{' '}
        {t.lab.map(l => clockLabel(l.minute)).join(', ')}, each within{' '}
        {worst.toFixed(2)} {DEMO_MODEL.unit} of the prediction.
      </p>

      <div aria-hidden className="relative mt-4 h-32 md:h-40">
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
        >
          {AXIS_HOURS.map(h => (
            <line
              key={h}
              x1={((24 - h) / 24) * W}
              x2={((24 - h) / 24) * W}
              y1={0}
              y2={H}
              stroke="var(--border)"
              strokeDasharray="2 4"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path
            d={line(p => p.actual)}
            fill="none"
            stroke="var(--foreground)"
            strokeOpacity={0.75}
            strokeWidth={1.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={line(p => p.predicted)}
            fill="none"
            stroke="var(--primary)"
            strokeWidth={1.75}
            strokeDasharray="6 4"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* One dot per hourly prediction. */}
        {t.hourly.map(h => (
          <span
            key={h.minute}
            className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${xPct(h.minute)}%`, top: `${yPct(h.predicted)}%` }}
          />
        ))}

        {t.lab.map(l => {
          const yLine = yPct(l.predicted)
          const yLab = yPct(l.actual)
          return (
            <span key={l.minute}>
              {/* The error: lab sample to the prediction at that minute. */}
              <span
                className="absolute w-px bg-muted-foreground/60"
                style={{
                  left: `${xPct(l.minute)}%`,
                  top: `${Math.min(yLine, yLab)}%`,
                  height: `${Math.abs(yLine - yLab)}%`,
                }}
              />
              <span
                className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] bg-foreground/85"
                style={{ left: `${xPct(l.minute)}%`, top: `${yLab}%` }}
              />
            </span>
          )
        })}

        {last && (
          <span
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: '100%', top: `${yPct(last.predicted)}%` }}
          >
            <span className="absolute inset-0 rounded-full bg-primary/40 motion-safe:animate-ping" />
            <span className="relative block size-2 rounded-full bg-primary ring-2 ring-card" />
          </span>
        )}
      </div>

      {/* Lab sample times, under their diamonds. */}
      <div
        aria-hidden
        className="relative mt-2 h-4 font-mono text-[11px] text-foreground"
      >
        {t.lab.map(l => (
          <span
            key={l.minute}
            className="absolute -translate-x-1/2 tabular-nums"
            style={{ left: `${xPct(l.minute)}%` }}
          >
            {clockLabel(l.minute)}
          </span>
        ))}
      </div>
      <div
        aria-hidden
        className="relative mt-1 h-4 border-t border-border pt-1 font-mono text-[11px] text-muted-foreground"
      >
        {AXIS_HOURS.map(h => (
          <span
            key={h}
            className={
              h === 24
                ? 'absolute left-0'
                : h === 0
                  ? 'absolute right-0 text-primary'
                  : // Phones keep only the two ends and the 12 h mark, so
                    // "now 16:20" never runs into its neighbour.
                    cn(
                      'absolute -translate-x-1/2',
                      h !== 12 && 'hidden sm:inline',
                    )
            }
            style={
              h === 24 || h === 0
                ? undefined
                : { left: `${((24 - h) / 24) * 100}%` }
            }
          >
            {h === 0 ? `now ${clockLabel(t.end)}` : clockLabel(t.end - h * 60)}
          </span>
        ))}
      </div>
    </figure>
  )
}
