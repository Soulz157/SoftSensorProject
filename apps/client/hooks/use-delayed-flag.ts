import { useEffect, useState } from 'react'

/**
 * Anti-flicker gate: `true` only after `active` has stayed `true` for
 * `delayMs`. Flips back to `false` immediately the instant `active` goes
 * false, so a caller can gate a loading skeleton without it flashing during
 * fast (<`delayMs`) resolutions.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [delayed, setDelayed] = useState(false)

  useEffect(() => {
    if (!active) {
      setDelayed(false)
      return
    }
    const timer = setTimeout(() => setDelayed(true), delayMs)
    return () => clearTimeout(timer)
  }, [active, delayMs])

  return delayed
}
