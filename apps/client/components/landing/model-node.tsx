import type { DemoModel } from '@/lib/landing-demo'

/** The node's slot: matches the trace's `left-[5.5rem]` in TagFeed. */
const SLOT_W = 88
const NODE_H = 40
const MID = NODE_H / 2
const CHIP_W = 40
const X0 = (SLOT_W - CHIP_W) / 2
const X1 = X0 + CHIP_W

/**
 * y of each left pin, relative to the node's centre. TagFeed ends tag i's
 * connector at the same offset so every tag lands on its own pin.
 */
export const PIN_OFFSETS = [-15, -5, 5, 15] as const

/**
 * px from the chip's right edge to the trace. The trace draws its own lead-in
 * wire over this gap (SignalTrace `leadIn`), so the output bends into the
 * live line instead of stopping at a fixed height.
 */
export const LEAD_IN = SLOT_W - X1

/**
 * The trained model in the landing tag feed: a microchip whose four left pins
 * are the four input tags, with the model's name as a badge underneath. The
 * prediction line leaves its right edge via SignalTrace's lead-in wire.
 */
export function ModelNode({
  model,
  active,
  step,
}: {
  model: DemoModel
  /** Index of the hovered input tag, if any. */
  active: number | null
  /** The feed's 1-second tick (held at 0 under reduced motion). */
  step: number
}) {
  const lit = active !== null
  return (
    <div
      className="absolute top-1/2 left-0 z-10 -translate-y-1/2"
      style={{ width: SLOT_W, height: NODE_H }}
    >
      <svg
        className="absolute inset-0 overflow-visible"
        width={SLOT_W}
        height={NODE_H}
        viewBox={`0 0 ${SLOT_W} ${NODE_H}`}
        aria-hidden
      >
        {PIN_OFFSETS.map((off, i) => (
          <line
            key={off}
            x1={0}
            y1={MID + off}
            x2={X0}
            y2={MID + off}
            stroke={active === i ? 'var(--primary)' : 'var(--border)'}
            strokeWidth={active === i ? 2 : 1.25}
            className="transition-[stroke]"
          />
        ))}
        {[X0 + 10, X0 + 20, X0 + 30].map(x => (
          <g key={x} stroke="var(--border)" strokeWidth={1.25}>
            <line x1={x} y1={-4} x2={x} y2={0} />
            <line x1={x} y1={NODE_H} x2={x} y2={NODE_H + 4} />
          </g>
        ))}
        <rect
          x={X0}
          y={0}
          width={CHIP_W}
          height={NODE_H}
          rx={6}
          fill="var(--card)"
          stroke={lit ? 'var(--primary)' : 'var(--border)'}
          strokeWidth={lit ? 1.5 : 1.25}
          className="transition-[stroke]"
        />
        <rect
          x={X0 + 10}
          y={10}
          width={CHIP_W - 20}
          height={NODE_H - 20}
          rx={2}
          fill="var(--primary)"
          fillOpacity={lit || step % 2 === 0 ? 0.28 : 0.12}
          stroke="var(--primary)"
          strokeWidth={1}
          className="transition-[fill-opacity] duration-700"
        />
      </svg>

      <span className="absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-md bg-card px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap text-foreground ring-1 ring-foreground/10">
        {`${model.algorithm} ${model.version}`}
      </span>
    </div>
  )
}
