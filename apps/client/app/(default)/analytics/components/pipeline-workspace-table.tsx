'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BINARY_STATUS_META, toBinaryStatus } from '@/lib/overview-status'
import type { WorkspacePipelineRow } from '@/lib/pipeline-metrics'

interface Props {
  rows: WorkspacePipelineRow[]
}

const HEADERS = [
  'Workspace',
  'Tags Synced',
  'Batch Success',
  'Last Update',
  'Health',
]

export function PipelineWorkspaceTable({ rows }: Props) {
  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">
          Pipeline by Workspace
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                {HEADERS.map(h => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={HEADERS.length}
                    className="px-4 py-6 text-center text-sm text-muted-foreground"
                  >
                    No workspaces yet.
                  </td>
                </tr>
              ) : (
                rows.map(row => (
                  <tr
                    key={row.id}
                    className="transition-colors hover:bg-accent/30"
                  >
                    <td className="px-4 py-3 text-sm font-medium text-foreground">
                      {row.name}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                      {row.tagsSynced}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-muted-foreground">
                      {row.batchSuccessPct.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {row.lastUpdate}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm text-foreground">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{
                            backgroundColor:
                              BINARY_STATUS_META[toBinaryStatus(row.status)]
                                .color,
                          }}
                        />
                        {BINARY_STATUS_META[toBinaryStatus(row.status)].label}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
