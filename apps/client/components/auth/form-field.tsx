import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'

/** Label + control + one-sentence error, wired for screen readers: pass the
 *  same `id` to the control and give it `aria-describedby={`${id}-error`}`. */
export function FormField({
  id,
  label,
  error,
  aside,
  children,
}: {
  id: string
  label: string
  error?: string
  /** Right side of the label row, e.g. a "Forgot password?" link. */
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
