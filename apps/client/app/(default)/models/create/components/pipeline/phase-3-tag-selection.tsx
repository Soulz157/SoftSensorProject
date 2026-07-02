'use client'

import { UnifiedTagTable } from '../unified-tag-table'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'

interface Props {
  nav: UsePipelineNavResult
}

export function Phase3TagSelection({ nav }: Props) {
  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <p className="text-sm font-medium text-foreground">Verified Tags</p>
        <p className="text-xs text-muted-foreground">
          Tags discovered from your selected sources. Fix or remove error rows
          before continuing.
        </p>
      </div>
      <UnifiedTagTable nav={nav} />
    </div>
  )
}
