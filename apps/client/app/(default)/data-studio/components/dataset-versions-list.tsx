'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useDatasetVersions } from '@/hooks/dataset/use-dataset-versions'
import { isAugmentedVersion } from '@/lib/retrain-handoff'

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
 * The EDA itself no longer renders inside each row: a row's Explore action
 * hands its artifact to the host (`onExplore`), which shows ONE full-width
 * "Explore this data" section (`RetrainVersionEda`, collapsible={false}) —
 * a 20rem side rail was too narrow for the analysis card's charts. The
 * dataset-scoped artifact endpoints do not filter on tier, which is why a
 * combined GOLD/FINAL pair is servable there with no backend change.
 */
export function DatasetVersionsList({
  datasetId,
  selectedArtifactId,
  onExplore,
}: {
  datasetId: string | null
  /** The artifact the host's Explore section is currently showing. */
  selectedArtifactId: string | null
  onExplore: (artifactId: string, label: string) => void
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
                  {version.artifactId === null ? (
                    <span className="ml-auto text-xs text-muted-foreground">
                      No stored data
                    </span>
                  ) : version.artifactId === selectedArtifactId ? (
                    <Badge variant="secondary" className="ml-auto">
                      Viewing
                    </Badge>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto h-6 px-2 text-xs"
                      onClick={() =>
                        onExplore(
                          version.artifactId!,
                          version.semanticVersion ??
                            `v${version.versionNumber}`,
                        )
                      }
                    >
                      Explore
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
