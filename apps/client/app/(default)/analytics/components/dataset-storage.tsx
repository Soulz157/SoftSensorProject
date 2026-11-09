import { formatBytes } from '@/lib/format-bytes'
import { formatCount, formatPct, storageShare } from '@/lib/data-intake'
import type { IntakeStorage, WorkspaceIntakeDataset } from '@/types/data-intake'

/** Bytes each saved dataset holds, from the recorded artifact sizes. Drafts
 *  that are not datasets yet are reported as one footer line. */
export function DatasetStorage({
  datasets,
  storage,
}: {
  datasets: WorkspaceIntakeDataset[]
  storage: IntakeStorage
}) {
  const max = datasets.reduce((m, d) => Math.max(m, d.sizeBytes), 0)

  return (
    <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">Dataset storage</h2>
        <span className="font-mono text-sm tabular-nums">
          {formatBytes(storage.totalBytes)}
        </span>
      </div>

      {datasets.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No datasets saved in this workspace yet.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {datasets.map(d => (
            <li
              key={d.id}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2.5 sm:grid-cols-[minmax(0,1fr)_5rem_5rem_5rem_5rem]"
            >
              <div className="min-w-0 space-y-1.5">
                <p className="truncate text-sm font-medium">{d.name}</p>
                <div
                  role="img"
                  aria-label={`${formatBytes(d.sizeBytes)} of the largest dataset's ${formatBytes(max)}`}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full bg-chart-1"
                    style={{ width: `${storageShare(d.sizeBytes, max)}%` }}
                  />
                </div>
              </div>
              <span className="text-right font-mono text-sm tabular-nums">
                {formatBytes(d.sizeBytes)}
              </span>
              <span className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums sm:block">
                {formatCount(d.rowCount)} rows
              </span>
              <span className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums sm:block">
                {d.tagCount} tags
              </span>
              <span className="hidden text-right font-mono text-xs text-muted-foreground tabular-nums sm:block">
                {formatPct(d.missingPct)} bad
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Drafts in progress: {formatBytes(storage.activeDraftBytes)} · Awaiting
        cleanup: {formatBytes(storage.cleanupBytes)}. Counts stored dataset
        artifacts only; prediction logs, model binaries and sidecar files are
        not included.
      </p>
    </section>
  )
}
