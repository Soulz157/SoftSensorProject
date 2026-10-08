import { useEffect, useState } from 'react'

/**
 * A step counter that ticks once a second for the landing's illustrative live
 * values. Holds at 0 when the user prefers reduced motion.
 */
export function useDemoTick(): number {
  const [step, setStep] = useState(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setStep(s => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [])

  return step
}
