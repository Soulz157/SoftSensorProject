'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  MOCKUP_MODEL,
  MONITORING_MOCKUP_FLAG,
  monitoringMockupEnabled,
} from '@/components/dev/monitoring-mockup-patch'

/** Flips the per-tab flag and reloads, so no real response stays cached. */
export function MonitoringMockupToggle() {
  const [on] = useState(monitoringMockupEnabled)

  const set = (next: boolean) => {
    try {
      if (next) window.sessionStorage.setItem(MONITORING_MOCKUP_FLAG, 'on')
      else window.sessionStorage.removeItem(MONITORING_MOCKUP_FLAG)
    } catch {
      // Storage blocked: the mode simply stays off.
    }
    window.location.reload()
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Monitoring mockup</h1>
      <p className="text-sm text-muted-foreground">
        Monitoring mockup is <strong>{on ? 'ON' : 'OFF'}</strong> in this
        browser tab. While on, ModelTest 1 shows as running and its Monitoring
        tab reads a fixed 31-day fixture built from the fake PI (the
        model&apos;s own predictions, the lab tag, input drift) instead of the
        backend. Nothing is written anywhere. Turn on Document mockup names too
        to show mock tag names.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => set(!on)}>{on ? 'Turn off' : 'Turn on'}</Button>
        <Button variant="outline" asChild>
          <Link href={`/models/${MOCKUP_MODEL.modelId}`}>Open ModelTest 1</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/dev/mockup-names">Document mockup names</Link>
        </Button>
      </div>
    </div>
  )
}
