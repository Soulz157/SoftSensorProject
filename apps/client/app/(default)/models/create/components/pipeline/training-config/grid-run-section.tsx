'use client'

import { Loader2 } from 'lucide-react'
import { useRunGridSearch } from '@/hooks/model/use-run-grid-search'
import { GridSearchResultsTable } from '../model-selection/grid-search-results-table'

interface Props {
  draftId: string
  runId: string
}

/**
 * MODEL-FLOW-038. A grid-search run's ranked combinations, inside the Run
 * parameters card — the same table Step 4's expanded row shows. The card's own
 * hyperparameter chips above are the WINNING combination; this is the search
 * that picked it. Mounted only for a run the list flagged `isGridSearch`, only
 * while its card is open.
 */
export function GridRunSection({ draftId, runId }: Props) {
  const { gridSearch, loading } = useRunGridSearch(draftId, runId)

  if (loading) {
    return (
      <p
        aria-busy
        className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading the grid search…
      </p>
    )
  }
  if (!gridSearch) {
    return (
      <p role="status" className="text-[10px] text-muted-foreground">
        The grid search results could not be read for this run.
      </p>
    )
  }
  return (
    <div className="-mx-2">
      <GridSearchResultsTable gridSearch={gridSearch} />
    </div>
  )
}
