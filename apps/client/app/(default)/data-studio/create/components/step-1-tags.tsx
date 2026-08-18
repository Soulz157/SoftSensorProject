'use client'

import { Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UseDatasetPipelineNavResult } from '@/hooks/dataset/use-dataset-pipeline-nav'
import { UnifiedTagTable } from './unified-tag-table'

interface Props {
  nav: UseDatasetPipelineNavResult
}

/** Read-only notice shown on the schema-locked steps (1/2/4) in edit mode. */
export function EditLockBanner({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}

export function Step1Tags({ nav }: Props) {
  const locked = nav.isEditLocked
  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Select Tags</h2>
        {locked ? (
          <EditLockBanner>
            Tags are locked while editing preprocessing — changing them would
            break downstream model schemas.
          </EditLockBanner>
        ) : (
          <p className="text-xs text-muted-foreground">
            Tags discovered from your selected sources. Fix or remove error rows
            before continuing.
          </p>
        )}
        <div className={cn(locked && 'pointer-events-none opacity-60')}>
          <UnifiedTagTable nav={nav} />
        </div>
      </div>
    </div>
  )
}
