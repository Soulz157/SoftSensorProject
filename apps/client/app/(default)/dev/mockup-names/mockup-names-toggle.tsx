'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  MOCKUP_NAMES_FLAG,
  mockupNamesEnabled,
} from '@/components/dev/mockup-names-patch'

/** Flips the per-tab flag and reloads, so no real-name data stays cached. */
export function MockupNamesToggle() {
  const [on] = useState(mockupNamesEnabled)

  const set = (next: boolean) => {
    try {
      if (next) window.sessionStorage.setItem(MOCKUP_NAMES_FLAG, 'on')
      else window.sessionStorage.removeItem(MOCKUP_NAMES_FLAG)
    } catch {
      // Storage blocked: the mode simply stays off.
    }
    window.location.reload()
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-lg font-semibold">Document mockup names</h1>
      <p className="text-sm text-muted-foreground">
        Mockup mode is <strong>{on ? 'ON' : 'OFF'}</strong> in this browser
        tab. While on, every page shows the agreed mock names for models, tags,
        datasets, plants and workspaces. Real names left in a response are
        reported in the console as <code>[mockup-names]</code>.
      </p>
      <Button onClick={() => set(!on)}>
        {on ? 'Turn off' : 'Turn on'}
      </Button>
    </div>
  )
}
