import type { ReactNode } from 'react'

interface Props {
  /** Pairs with the section's `aria-labelledby`. */
  id: string
  icon: ReactNode
  title: string
  description: string
  badge?: ReactNode
}

/**
 * Heading for one side of Model Step 2's split: "Training data" or
 * "Validation data". The icon carries that side's color (primary for
 * training, `chart-5` for validation) so it matches the split strip above.
 */
export function ReviewSectionHeading({
  id,
  icon,
  title,
  description,
  badge,
}: Props) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h3
          id={id}
          className="flex items-center gap-2 text-base font-semibold text-foreground"
        >
          {icon}
          {title}
        </h3>
        <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      {badge}
    </div>
  )
}
