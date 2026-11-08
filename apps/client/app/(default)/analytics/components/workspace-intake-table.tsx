import Link from 'next/link'
import { formatBytes } from '@/lib/format-bytes'
import { formatCount, tagSegments, totalTags } from '@/lib/data-intake'
import type { WorkspaceIntakeRow } from '@/types/data-intake'
import { cn } from '@/lib/utils'
import { TAG_SWATCH } from './tag-proportion'

/** All-workspaces scope: one row per workspace; the name drills in. */
export function WorkspaceIntakeTable({ rows }: { rows: WorkspaceIntakeRow[] }) {
  return (
    <section className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <h2 className="text-base font-medium">Intake by workspace</h2>

      {rows.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          There are no workspaces yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-xs">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Workspace
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Live models
                </th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                  Live tag quality
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Rows ingested
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Storage
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Datasets
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const total = totalTags(r.tags)
                const segments = tagSegments(r.tags)
                return (
                  <tr
                    key={r.id}
                    className="border-b border-border/50 hover:bg-muted/20"
                  >
                    <td className="px-4 py-2">
                      <Link
                        href={`/analytics/${r.id}`}
                        className="font-medium hover:underline"
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {r.liveModels}
                    </td>
                    <td className="px-4 py-2">
                      {total === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div
                            role="img"
                            aria-label={segments
                              .map(s => `${s.label} ${s.count}`)
                              .join(', ')}
                            className="flex h-1.5 w-24 overflow-hidden rounded-full bg-muted"
                          >
                            {segments.map(s => (
                              <span
                                key={s.quality}
                                className={cn('h-full', TAG_SWATCH[s.quality])}
                                style={{ width: `${s.pct}%` }}
                              />
                            ))}
                          </div>
                          <span className="font-mono text-xs text-muted-foreground tabular-nums">
                            {total} tags · {r.tags.bad} Bad
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {formatCount(r.rowsIngested)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {formatBytes(r.storageBytes)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {r.datasetCount}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
