'use client'

import { useState } from 'react'
import { AlertTriangle, Sparkles, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { RetrainIncumbent } from '@/services/model-retrain'
import type { CandidateInput } from '@/services/model-draft'
import type { AIModel } from '@/types'
import { CustomFinetuneForm } from './custom-finetune-form'
import { RetrainMonitoringContext } from './retrain-monitoring-context'

export function ModelRetrainDialog({
  open,
  onClose,
  model,
  incumbent,
  loading,
  isRetraining,
  error,
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
  onStart: (candidates?: CandidateInput[]) => void
}) {
  const [hyperparameters, setHyperparameters] = useState<Record<
    string,
    unknown
  > | null>(null)

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

  return (
    <Dialog open={open} onOpenChange={o => !o && !isRetraining && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Retrain {model.name}</DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-xs text-muted-foreground">
            Checking the current production version…
          </p>
        )}

        {noIncumbent && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
            This model has no PRODUCTION version yet — promote a version
            before retraining. A retrain improves on what is live.
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs font-medium text-destructive">
            <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {incumbent !== null && <RetrainMonitoringContext model={model} />}

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
              hyperparameter shortlist and keeps the best result by RMSE. No
              configuration needed.
            </p>
            <Button
              className="w-full gap-2"
              onClick={() => {
                onStart(undefined)
                onClose()
              }}
              disabled={disabled}
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
            />
            <Button
              className="w-full gap-2"
              onClick={() => {
                if (!incumbent || !hyperparameters) return
                onStart([{ algorithm: incumbent.algorithm, hyperparameters }])
                onClose()
              }}
              disabled={disabled || !hyperparameters}
            >
              <Wand2 className="h-4 w-4" />
              {isRetraining ? 'Retraining…' : 'Start Custom Finetune'}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
