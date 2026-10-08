import { cn } from '@/lib/utils'

export type BrandMarkVariant = 'line' | 'framed' | 'tile'

/**
 * SoftSensor mark: a calm predicted curve with a lab sample (the diamond)
 * sitting on it — what the product does, drawn once. The curve follows
 * `currentColor`; the diamond is the signal colour, cut out of the line by
 * a thin ring in the surface colour so the two never merge. Tokens only, so
 * it works in both themes.
 */
const CURVE = 'M2.5 16C6.5 16 8 12 12 12s5.5-4 9.5-4'

function Diamond({ fill, knockout }: { fill: string; knockout: string }) {
  return (
    <rect
      x="9.2"
      y="9.2"
      width="5.6"
      height="5.6"
      rx="0.8"
      transform="rotate(45 12 12)"
      fill={fill}
      stroke={knockout}
      strokeWidth="2"
      paintOrder="stroke"
    />
  )
}

export function BrandMark({
  variant = 'line',
  size = 28,
  wordmark = true,
  surface = 'var(--card)',
  className,
}: {
  variant?: BrandMarkVariant
  size?: number
  wordmark?: boolean
  /** Colour behind the mark — used for the ring that separates the diamond
   *  from the curve. Ignored by `tile`, which supplies its own surface. */
  surface?: string
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden={wordmark ? true : undefined}
        role={wordmark ? undefined : 'img'}
        aria-label={wordmark ? undefined : 'SoftSensor'}
        className="shrink-0"
      >
        {variant === 'tile' && (
          <rect width="24" height="24" rx="6" fill="var(--primary)" />
        )}
        {variant === 'framed' && (
          <rect
            x="0.75"
            y="0.75"
            width="22.5"
            height="22.5"
            rx="5.5"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1.5"
          />
        )}
        <path
          d={CURVE}
          stroke={
            variant === 'tile' ? 'var(--primary-foreground)' : 'currentColor'
          }
          strokeWidth="2"
          strokeLinecap="round"
        />
        <Diamond
          fill={
            variant === 'tile' ? 'var(--primary-foreground)' : 'var(--primary)'
          }
          knockout={variant === 'tile' ? 'var(--primary)' : surface}
        />
      </svg>
      {wordmark && (
        <span className="text-base leading-none font-semibold tracking-tight">
          SoftSensor
        </span>
      )}
    </span>
  )
}
