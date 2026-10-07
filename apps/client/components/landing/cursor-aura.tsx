'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * A soft signal-blue light behind the landing page that eases toward the
 * pointer and drifts back to rest (beside the model diagram) when the pointer
 * leaves. User request 2026-10-07 — a deliberate exception to DESIGN.md's
 * no-glow rule, kept inside its other limits: built from `--primary` only,
 * a plain radial gradient (no backdrop-filter blur), low strength. Reduced
 * motion: held still at the rest point, never follows.
 *
 * Positions are written straight to CSS variables in a rAF loop — no React
 * re-render per frame — and the loop stops once the light has settled.
 */
export function CursorAura({
  rest = { x: 0.7, y: 0.45 },
  className,
}: {
  /** Where the light rests without a pointer, as fractions of the box. */
  rest?: { x: number; y: number }
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

    let cur = { x: rest.x, y: rest.y }
    let target = { ...cur }
    let raf = 0

    const paint = () => {
      el.style.setProperty('--aura-x', `${(cur.x * 100).toFixed(2)}%`)
      el.style.setProperty('--aura-y', `${(cur.y * 100).toFixed(2)}%`)
    }
    paint()

    const tick = () => {
      // Ease ~12% of the way each frame: a light that trails, not a cursor.
      cur = {
        x: cur.x + (target.x - cur.x) * 0.12,
        y: cur.y + (target.y - cur.y) * 0.12,
      }
      paint()
      if (
        Math.abs(target.x - cur.x) > 0.0005 ||
        Math.abs(target.y - cur.y) > 0.0005
      ) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onMove = (e: PointerEvent) => {
      if (reduce.matches || e.pointerType === 'touch') return
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return
      target = {
        x: (e.clientX - r.left) / r.width,
        y: (e.clientY - r.top) / r.height,
      }
      kick()
    }
    const onLeave = () => {
      target = { x: rest.x, y: rest.y }
      kick()
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      document.documentElement.removeEventListener('pointerleave', onLeave)
    }
  }, [rest.x, rest.y])

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-0 opacity-70 dark:opacity-100',
        className,
      )}
      style={{
        background:
          'radial-gradient(42rem circle at var(--aura-x, 70%) var(--aura-y, 45%), color-mix(in oklch, var(--primary) 16%, transparent), color-mix(in oklch, var(--primary) 5%, transparent) 40%, transparent 70%)',
      }}
    />
  )
}
