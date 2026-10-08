'use client'

import { useEffect, useState } from 'react'
import { formatElapsed } from '@/lib/dataset-fetch'

interface Props {
  /** Epoch ms the current fetch run started — `fetch.detail.startedAt`. */
  startedAt: number
}

/**
 * Live "time since the fetch started" clock, ticked once a second.
 *
 * Deliberately its OWN component: Step 2 renders `RawReadingsTable` with the
 * partial grid while batches land, so ticking in the parent would re-render the
 * whole table every second. Keeping the tick here confines it to this span.
 */
export function FetchElapsed({ startedAt }: Props) {
  // Tick the clock, derive the elapsed time — never accumulate. A
  // backgrounded tab throttles intervals to ~1/min, which would freeze an
  // accumulated counter instead of just making it update coarsely. A new
  // `startedAt` re-derives on the very next render; clamped because the last
  // tick can predate it by up to a second.
  const [now, setNow] = useState(() => Date.now())
  const elapsedMs = Math.max(0, now - startedAt)

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    // aria-hidden: the batch/tag status line next to this is the announced
    // content — a per-second clock would spam a screen reader with no new info.
    <span
      aria-hidden
      className="font-mono text-xs tabular-nums text-muted-foreground"
    >
      {formatElapsed(elapsedMs)}
    </span>
  )
}
