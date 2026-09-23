'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { RetrainIncumbent } from '@/services/model-retrain'
import type { CandidateInput } from '@/services/model-draft'
import type { AIModel } from '@/types'
import { CustomFinetuneForm } from './custom-finetune-form'
import { RetrainMonitoringContext } from './retrain-monitoring-context'
import { cn } from '@/lib/utils'
import {
  RetrainBaseDataset,
  RetrainDataStrategy,
  retrainUsesNewData,
  type RetrainDataStrategy as RetrainDataStrategyValue,
} from './retrain-data-strategy'

export interface StartRetrainOptions {
  strategy?: RetrainDataStrategyValue
  additionalDatasetVersionId?: string
  /** Both or neither — the server refuses a half-open window. ISO-8601. */
  newValidationFrom?: string
  newValidationTo?: string
}

export function ModelRetrainDialog({
  open,
  onClose,
  model,
  incumbent,
  loading,
  isRetraining,
  error,
  resumed,
  onStart,
}: {
  open: boolean
  onClose: () => void
  model: AIModel
  /** Null while loading, or when the model has no PRODUCTION version —
   *  either way there is nothing to retrain against yet. */
  incumbent: RetrainIncumbent | null
  /** True while the incumbent is still being fetched. Distinct from
   *  `incumbent === null`, which is a FACT (no PRODUCTION version) — see
   *  the pre-flight note below. */
  loading: boolean
  isRetraining: boolean
  error: string | null
  /**
   * MODEL-SERVE-017. Present when the operator has just come back from the
   * Data Studio wizard, having built a dataset for this retrain — restores
   * the strategy they chose and preselects what they made. Null on a normal
   * open.
   */
  resumed?: {
    strategy: 'AUGMENT_DATA' | 'NEW_DATA_ONLY'
    datasetId: string | null
    versionId: string | null
  } | null
  onStart: (
    candidates?: CandidateInput[],
    options?: StartRetrainOptions,
  ) => void
}) {
  const [hyperparameters, setHyperparameters] = useState<Record<
    string,
    unknown
  > | null>(null)
  // MODEL-SERVE-015-T01. Reset to the 014 default whenever the dialog
  // (re)opens for a different model — a strategy chosen for one model must
  // never leak into the next dialog open.
  const [dataStrategy, setDataStrategy] = useState<RetrainDataStrategyValue>(
    resumed?.strategy ?? 'KEEP_EXISTING',
  )
  // Null until the operator has filled in BOTH bounds; the strategy
  // component owns that rule so a half-typed range never reaches here.
  const [validationWindow, setValidationWindow] = useState<{
    from: string
    to: string
  } | null>(null)
  const [additionalDatasetVersionId, setAdditionalDatasetVersionId] = useState<
    string | null
  >(resumed?.versionId ?? null)

  // MODEL-SERVE-017. The dialog is remounted by the return navigation, so the
  // initial state above is normally enough. This re-seeds it for the case
  // where it is not — arriving while the component is already mounted —
  // keyed on the resumed values so it never fights the operator's own later
  // edits within one visit.
  useEffect(() => {
    if (!resumed) return
    setDataStrategy(resumed.strategy)
    setAdditionalDatasetVersionId(resumed.versionId ?? null)
  }, [resumed?.strategy, resumed?.versionId])

  // MODEL-SERVE-017. Forwards whichever new-data strategy was chosen rather
  // than a hardcoded AUGMENT_DATA, so NEW_DATA_ONLY cannot silently submit as
  // an augmentation and train on rows the operator asked to leave out.
  const startOptions: StartRetrainOptions | undefined =
    retrainUsesNewData(dataStrategy) && additionalDatasetVersionId
      ? {
          strategy: dataStrategy,
          additionalDatasetVersionId,
          // Spread so the keys are ABSENT rather than explicitly undefined
          // when no window was chosen — the trigger schema is .strict() and
          // both-or-neither.
          ...(validationWindow
            ? {
                newValidationFrom: validationWindow.from,
                newValidationTo: validationWindow.to,
              }
            : {}),
        }
      : undefined

  // MODEL-SERVE-014-T08. A model with no PRODUCTION version 404s the trigger
  // — refused BEFORE the user submits, matching triggerRetrainService's own
  // precondition, rather than surfacing it only as a failed request.
  //
  // CORRECTED: this used to be a bare `incumbent === null`, which asserted
  // "no PRODUCTION version" for THREE different states — the real one, a
  // still-in-flight fetch, and any failed read (a 404 from a route the
  // running server had not registered, a 403, a dropped request). A model
  // with a promoted version was told to promote one, and the actual error
  // was hidden by this same banner's own `!noIncumbent` guard below. Only
  // a settled, error-free read is allowed to make that claim now.
  const noIncumbent = !loading && error === null && incumbent === null
  const disabled = isRetraining || loading || incumbent === null
  // AUGMENT_DATA chosen but no version picked yet — a retrain still trains
  // nothing without one.
  const augmentIncomplete =
    retrainUsesNewData(dataStrategy) && !additionalDatasetVersionId

  return (
    <Dialog open={open} onOpenChange={o => !o && !isRetraining && onClose()}>
      {/* Two vertical grid rows — header, then body — at a DEFINITE height.
          `h-[90vh]`, not `max-h-`: Radix's scroll viewport is `height: 100%`,
          and a percentage against an indefinite height resolves to nothing,
          so the dialog grew with its content instead of scrolling. That is
          why expanding "Explore this data" or switching to Custom Finetune
          pushed the tail off-screen with no way to reach it.
          `minmax(0,1fr)` on the body row is the other half: a grid row's
          default `auto` minimum refuses to shrink below content, which would
          hand the scroll container an unbounded height again. */}
      <DialogContent className="grid h-[90vh] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-6xl">
        <DialogHeader className="border-b border-border p-6 pb-4">
          <DialogTitle>Retrain {model.name}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="min-h-0">
          {/* Landscape: decisions on the left, read-only context on the
              right (base dataset + drift/PSI). Stacks below `md`. The right
              column exists only once an incumbent does — with none, there is
              no base dataset or monitoring to show, and an empty 17rem track
              would just squeeze the left. */}
          {/* `min-h-0` on this grid and its columns, not just `min-w-0`: a
              grid item's default `min-height: auto` refuses to shrink below
              its content, which is the same trap the body row above solves
              with `minmax(0,1fr)`. */}
          <div
            className={cn(
              'grid min-h-0 gap-6 p-6',
              incumbent !== null && 'md:grid-cols-[minmax(0,1fr)_17rem]',
            )}
          >
            <div className="min-h-0 min-w-0 space-y-4">
              {loading && (
                <p className="text-xs text-muted-foreground">
                  Checking the current production version…
                </p>
              )}

              {noIncumbent && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  />
                  This model has no PRODUCTION version yet — promote a version
                  before retraining. A retrain improves on what is live.
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive">
                  <AlertTriangle
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                  />
                  {error}
                </div>
              )}

              {incumbent !== null && (
                <RetrainDataStrategy
                  workspaceId={model.workspaceId}
                  modelId={model.id}
                  incumbent={incumbent}
                  strategy={dataStrategy}
                  onStrategyChange={setDataStrategy}
                  additionalDatasetVersionId={additionalDatasetVersionId}
                  onValidationWindowChange={setValidationWindow}
                  onAdditionalDatasetVersionChange={
                    setAdditionalDatasetVersionId
                  }
                  initialDatasetId={resumed?.datasetId ?? null}
                  disabled={disabled}
                />
              )}

              <Tabs defaultValue="auto" className="flex w-full flex-col">
                <TabsList className="flex h-10 w-full flex-row items-center rounded-md bg-muted p-1">
                  <TabsTrigger value="auto" className="flex-1">
                    Auto Finetune
                  </TabsTrigger>
                  <TabsTrigger value="custom" className="flex-1">
                    Custom Finetune
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="auto" className="space-y-4 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Searches the current production algorithm&apos;s own curated
                    hyperparameter shortlist and keeps the best result by RMSE.
                    No configuration needed.
                  </p>
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      onStart(undefined, startOptions)
                      onClose()
                    }}
                    disabled={disabled || augmentIncomplete}
                  >
                    <Sparkles className="h-4 w-4" />
                    {isRetraining ? 'Retraining…' : 'Start Auto Finetune'}
                  </Button>
                </TabsContent>

                <TabsContent value="custom" className="space-y-4 pt-4">
                  <CustomFinetuneForm
                    algorithm={incumbent?.algorithm ?? null}
                    hyperparameters={hyperparameters}
                    onChange={setHyperparameters}
                    disabled={disabled}
                    modelId={model.id}
                  />
                  <Button
                    className="w-full gap-2"
                    onClick={() => {
                      if (!incumbent || !hyperparameters) return
                      onStart(
                        [{ algorithm: incumbent.algorithm, hyperparameters }],
                        startOptions,
                      )
                      onClose()
                    }}
                    disabled={disabled || augmentIncomplete || !hyperparameters}
                  >
                    <Wand2 className="h-4 w-4" />
                    {isRetraining ? 'Retraining…' : 'Start Custom Finetune'}
                  </Button>
                </TabsContent>
              </Tabs>
            </div>

            {incumbent !== null && (
              <aside className="min-h-0 min-w-0 space-y-4">
                <RetrainBaseDataset incumbent={incumbent} />
                <RetrainMonitoringContext model={model} />
              </aside>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
