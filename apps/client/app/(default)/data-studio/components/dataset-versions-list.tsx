'use client'

import { Badge } from '@/components/ui/badge'
import { useDatasetVersions } from '@/hooks/dataset/use-dataset-versions'
import { isAugmentedVersion } from '@/lib/retrain-handoff'
import { RetrainVersionEda } from '@/app/(default)/models/[id]/components/retrain-version-eda'

/**
 * MODEL-SERVE-015-T06. The dataset's saved versions, each explorable.
 *
 * Why this exists: before T06 an augmented retrain minted its combined
 * GOLD+FINAL pair with no `DatasetVersion` row at all, so the data was
 * reachable by nothing that browses a dataset — the detail sheet reads only
 * `Dataset.currentArtifactId`, which a retrain deliberately never repoints.
 * Registering the version made the row exist; this list is what makes it
 * visible, and the per-row Explore action is what satisfies "the combined
 * dataset is explorable", not merely listed.
 *
 * `RetrainVersionEda` is reused verbatim rather than reimplemented: despite
 * its name it is already store-agnostic, taking `datasetId` + `artifactId`
 * and routing every tab through the dataset-scoped artifact endpoints. Those
 * endpoints do not filter on artifact tier, which is exactly why a combined
 * GOLD/FINAL pair is servable here with no backend change.
 */
export function DatasetVersionsList({
  datasetId,
  tags,
}: {
  datasetId: string | null
  tags: string[]
}) {
  const { versions, loading, error } = useDatasetVersions(datasetId)

  if (!datasetId) return null

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Versions</h3>

      {loading && (
        <p className="text-xs text-muted-foreground">Loading versions…</p>
      )}

      {/* An empty list and a failed fetch must not look the same. */}
      {error && !loading && (
        <p className="text-xs text-muted-foreground">
          Could not load versions: {error}
        </p>
      )}

      {!loading && !error && versions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          This dataset has no saved versions yet.
        </p>
      )}

      {versions.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {versions.map(version => {
            return (
              <li key={version.id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">
                    {version.semanticVersion ?? `v${version.versionNumber}`}
                  </span>

                  {/* Neutral, never a traffic-light colour: red/amber stay
                      reserved for workspace and plant status. */}
                  {isAugmentedVersion(version) && (
                    <Badge variant="secondary">Combined</Badge>
                  )}
                  <Badge variant="outline">{version.status}</Badge>

                  <span className="text-xs text-muted-foreground">
                    {version.rowCount.toLocaleString()} rows
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {/* An unset featureCount shows as "—". A combined version
                        has no validation report to source it from, and a
                        literal 0 would read as a measured fact. */}
                    {version.featureCount > 0 ? version.featureCount : '—'}{' '}
                    features
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(version.createdAt).toLocaleString()}
                  </span>

                  {/* A version backfilled without an artifact reference has
                      no bytes to resolve, so it says so rather than offering
                      an Explore that would 404. */}
                  {version.artifactId === null && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      No stored data
                    </span>
                  )}
                </div>

                {/* No toggle of our own: RetrainVersionEda already owns an
                    "Explore this data" disclosure and fetches nothing until
                    it is opened. Wrapping it in a second collapse would make
                    the operator click twice to see one panel. */}
                {version.artifactId && (
                  <RetrainVersionEda
                    datasetId={datasetId}
                    artifactId={version.artifactId}
                    // Tags come off the dataset: a version row carries none.
                    tags={tags}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
