'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { brandModelVersionNumber } from '@/lib/model-version-number'
import { useModelVersions } from '@/hooks/model/use-model-versions'
import { useModelPromote } from '@/hooks/model/use-model-promote'
import type { ModelVersionRow } from '@/services/model-version'

interface Props {
  modelId: string
}

/** `—`, never `0`. An RMSE of zero is a perfect model; it is the worst
 *  possible stand-in for "this version did not record one". */
function metric(value: number | null, digits = 3): string {
  return value === null ? '—' : value.toFixed(digits)
}

/**
 * Plain words on a neutral chip. NOT the monitoring red/amber palette —
 * that vocabulary is reserved for workspace and plant status, and an
 * ARCHIVED version is a lifecycle fact, not a fault.
 */
function StageChip({ stage }: { stage: ModelVersionRow['stage'] }) {
  if (stage === 'PRODUCTION') {
    return (
      <Badge className="border-0 bg-primary/10 text-primary">production</Badge>
    )
  }
  return (
    <Badge variant="secondary" className="font-normal">
      {stage.toLowerCase()}
    </Badge>
  )
}

/**
 * MODEL-SERVE-016-T02/T03. Every version of this model with the metrics it
 * FROZE at creation time, and the ability to put one back into production.
 *
 * WHY ITS OWN TAB (D01). A header dropdown re-pointing the whole page was
 * the rejected alternative: every other tab would then have to say which
 * version it was showing, or a reader takes live monitoring for historical.
 * This tab makes exactly one claim, about numbers that do not move.
 *
 * TRAINING-TIME, SAID OUT LOUD (D03). These are not the Evaluation tab's
 * numbers. That tab computes RMSE/R²/MAE live from applied lab points — how
 * production is doing NOW. These are the scores each version was accepted
 * with. Unlabelled beside a Monitoring tab full of live figures, a reader
 * would reasonably assume they were current, so the caption says so.
 */
export function VersionsTab({ modelId }: Props) {
  const { versions, loading, error, refetch } = useModelVersions(modelId)
  const [confirm, setConfirm] = useState<ModelVersionRow | null>(null)
  const promote = useModelPromote(() => {
    setConfirm(null)
    void refetch()
  })

  const current = versions.find(v => v.stage === 'PRODUCTION') ?? null

  if (loading && versions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Loading versions…
      </p>
    )
  }

  if (error) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">{error}</p>
    )
  }

  if (versions.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        This model has no saved versions yet.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Scores each version was trained and accepted with — frozen at that
        moment, not a live measurement. For how production is performing right
        now, see the Evaluation tab.
      </p>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Version</th>
              <th className="px-3 py-2 text-left font-medium">Stage</th>
              <th className="px-3 py-2 text-left font-medium">Algorithm</th>
              <th className="px-3 py-2 text-right font-medium">RMSE</th>
              <th className="px-3 py-2 text-right font-medium">R²</th>
              <th className="px-3 py-2 text-right font-medium">MAE</th>
              <th className="px-3 py-2 text-left font-medium">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {versions.map(v => (
              <tr key={v.id} className="border-t border-border">
                <td className="px-3 py-2 font-mono">v{v.version}</td>
                <td className="px-3 py-2">
                  <StageChip stage={v.stage} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {v.algorithm}
                  {/* Only present on a retrained version — absent entirely
                      for one created by Save Model or a plain retrain, so
                      no placeholder. */}
                  {v.retrainStrategy && (
                    <span className="ml-1 text-xs opacity-70">
                      · {v.retrainStrategy.toLowerCase().replace(/_/g, ' ')}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {metric(v.metrics.rmse)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {metric(v.metrics.r2)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  {metric(v.metrics.mae)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(v.createdAt).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-right">
                  {v.stage !== 'PRODUCTION' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      disabled={promote.busy}
                      onClick={() => setConfirm(v)}
                    >
                      Make production
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AlertDialog
        open={confirm !== null}
        onOpenChange={open => !open && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Put v{confirm?.version} into production?
            </AlertDialogTitle>
            {/* D02: names which version STOPS serving. This table is a
                comparison screen that has been given a deploy control, so
                the confirm has to state what changes rather than ask a bare
                "are you sure". */}
            <AlertDialogDescription>
              {current
                ? `v${current.version} is serving now and will be archived. Inference switches to v${confirm?.version}.`
                : `This model has no version in production. Inference will start serving v${confirm?.version}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={promote.busy}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={promote.busy}
              onClick={event => {
                // Held open until the request resolves — `useModelPromote`
                // closes it through `onPromoted`, and a 422 keeps it open so
                // the refusal it raises is not orphaned behind a dialog that
                // already dismissed itself.
                event.preventDefault()
                if (!confirm) return
                void promote.promote(
                  modelId,
                  brandModelVersionNumber(confirm.version),
                )
              }}
            >
              {promote.busy ? 'Promoting…' : 'Make production'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* The server's own refusal text (the r² floor, a missing artifact),
          surfaced rather than reworded — `useModelPromote`'s whole design is
          that the SERVER decides and this side quotes it. */}
      <AlertDialog
        open={promote.overridePrompt !== null}
        onOpenChange={open => !open && promote.dismissOverride()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Promotion refused</AlertDialogTitle>
            <AlertDialogDescription>
              {promote.overridePrompt}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
