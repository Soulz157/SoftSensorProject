'use client'

import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { UnifiedTagTable } from './unified-tag-table'

interface Props {
  nav: UseDatasetPipelineNavResult
}

export function Step1Tags({ nav }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">Select Tags</h2>
        <p className="text-xs text-muted-foreground py-3">
          Tags discovered from your selected sources. Fix or remove error rows
          before continuing.
        </p>
        <UnifiedTagTable nav={nav} />
      </div>
    </div>
  )
}
