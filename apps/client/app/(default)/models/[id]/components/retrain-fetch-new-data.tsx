'use client'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useRetrainBaseDataset } from '@/hooks/model/use-retrain-fetch-dataset'
import { useRetrainDatasetHandoff } from '@/hooks/dataset/use-retrain-dataset-handoff'
import { useDataSources } from '@/hooks/use-data-sources'

/**
 * MODEL-SERVE-017. Hands off to the Data Studio wizard to build a NEW dataset
 * for a retrain, inheriting the base dataset's recipe.
 *
 * It asks for nothing. Two earlier versions asked for too much:
 *  - It fetched the window itself as a preview, and threw the rows away — the
 *    wizard then fetched the identical window again ("stuck in fetch data
 *    again"). The wizard's fetch is also the one that fires
 *    `useDatasetBronzeWarm`'s materialize, which creates the draft and BRONZE
 *    artifact everything downstream reads, so it could not simply be skipped.
 *  - It then still collected the From/To dates, which Step 2 collects again —
 *    the same date range entered twice. The pickers now live only in Step 2,
 *    with the incumbent's split boundary carried across so that constraint
 *    travels with them rather than being lost.
 *
 * What remains is the decision this screen actually owns: that the new data
 * will be fetched, from this base dataset's own source and tags.
 */
export function RetrainFetchNewData({
  baseDatasetId,
  cutTimestamp,
  modelId,
  strategy,
  disabled,
}: {
  baseDatasetId: string | null
  /** Passed through to the wizard, where Step 2's From picker clamps to it. */
  cutTimestamp: string | null
  /** Where to return once the new dataset is saved in the wizard. */
  modelId: string
  strategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY'
  disabled?: boolean
}) {
  const { baseDataset, baseTags, loadingBase } =
    useRetrainBaseDataset(baseDatasetId)
  const { sources, loading: sourcesLoading } = useDataSources()
  const handoff = useRetrainDatasetHandoff()

  return (
    <div className="space-y-3">
      {loadingBase ? (
        <Skeleton className="h-4 w-56" />
      ) : (
        baseTags.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Builds a new dataset from this model&apos;s own source and its{' '}
            {baseTags.length} {baseTags.length === 1 ? 'tag' : 'tags'}, using
            the same recipe — so the result stays schema-compatible with the
            current version.
          </p>
        )
      )}

      {cutTimestamp && (
        <p className="text-xs text-muted-foreground">
          The window is chosen in Data Studio and must start after{' '}
          {cutTimestamp} — earlier rows are the test set this model is scored
          on.
        </p>
      )}

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={disabled || !baseDataset || sourcesLoading}
        onClick={() => {
          if (!baseDataset) return
          handoff(baseDataset, sources, cutTimestamp, { modelId, strategy })
        }}
      >
        Build this dataset in Data Studio
      </Button>
      <p className="text-xs text-muted-foreground">
        Pick the time range there, fetch, review, and save — you come back here
        with it selected.
      </p>
    </div>
  )
}
