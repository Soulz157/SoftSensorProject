'use client'

import { useState } from 'react'
import { Settings2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useWriteBack } from '@/hooks/model/use-write-back'
import { useWriteBackConfig } from '@/hooks/model/use-write-back-config'
import type { LabRow } from '@/lib/evaluation-lab'
import type {
  EvaluationCompareResult,
  WriteBackKind,
} from '@/services/model-evaluation'
import { WriteBackConfigDialog } from './write-back-config-dialog'
import { WriteBackConfirmDialog } from './write-back-confirm-dialog'

function TagLine({ label, tag }: { label: string; tag: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {tag ? (
        <span className="truncate font-mono text-foreground">{tag}</span>
      ) : (
        <span className="text-muted-foreground">Not set</span>
      )}
    </div>
  )
}

/**
 * MODEL-SERVE-032. Write the model's predictions, and the corrected lab
 * values, into PI.
 *
 * Both writes go to OUTPUT tags the owner configured, never to the model's
 * own lab target. Each is a two-step action: the server is asked what the
 * write would do (a dry run), the answer is shown, and only a confirm writes.
 * Controls an owner / admin may not use are disabled with the reason in
 * words, not hidden.
 */
export function WriteBackCard({
  modelId,
  data,
  labRows,
  onWritten,
}: {
  modelId: string
  data: EvaluationCompareResult | null
  labRows: readonly LabRow[]
  /** Called after a write completes (any outcome), so history can refresh. */
  onWritten: () => void
}) {
  const cfg = useWriteBackConfig(modelId)
  const wb = useWriteBack({
    modelId,
    data,
    rows: labRows,
    view: cfg.view,
    onWritten,
  })
  const [configOpen, setConfigOpen] = useState(false)
  const { view } = cfg

  if (cfg.loading && !view) {
    return <Skeleton className="h-40 rounded-lg" />
  }
  if (!view) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="py-5 text-sm text-muted-foreground">
          {cfg.error ?? 'Write-back settings are unavailable.'}
        </CardContent>
      </Card>
    )
  }

  const actions: Array<{ kind: WriteBackKind; label: string }> = [
    { kind: 'PREDICTION', label: 'Write predictions to PI' },
    { kind: 'LAB', label: 'Write lab values to PI' },
  ]

  return (
    <Card className="border-border bg-card">
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Write back to PI
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {view.source
                ? `${view.source.name} · written as ${view.source.piAccount}`
                : 'This model has no production data source.'}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setConfigOpen(true)}
            disabled={!view.canWrite || !view.source?.writable}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {view.config ? 'Edit output tags' : 'Set output tags'}
          </Button>
        </div>

        <div className="space-y-1.5">
          <TagLine
            label="Prediction output tag"
            tag={view.config?.predictionTag ?? null}
          />
          <TagLine label="Lab output tag" tag={view.config?.labTag ?? null} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {actions.map(({ kind, label }) => {
            const blocker = wb.blockerFor(kind)
            return (
              <div key={kind} className="space-y-1.5">
                <Button
                  className="w-full gap-2"
                  disabled={blocker !== null || wb.preparing !== null}
                  onClick={() => void wb.prepare(kind)}
                >
                  <Upload className="h-4 w-4" />
                  {wb.preparing === kind ? 'Checking…' : label}
                </Button>
                {blocker && (
                  <p className="text-[11px] text-muted-foreground">{blocker}</p>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>

      <WriteBackConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        view={view}
        onSave={cfg.save}
      />
      <WriteBackConfirmDialog
        dryRun={wb.pending}
        writing={wb.writing}
        onConfirm={() => void wb.confirm()}
        onCancel={wb.cancel}
      />
    </Card>
  )
}
