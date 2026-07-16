'use client'

/**
 * Model-wizard Phase 3 — "Verified Tags". Placeholder for now: the data-studio
 * `UnifiedTagTable` is coupled to the dataset pipeline nav (`dw*` atoms) and
 * cannot consume the model wizard's `UsePipelineNavResult`. A model-specific
 * tag table over `hooks/model/use-model-tag-selection` is the proper follow-up.
 */
export function Phase3TagSelection() {
  return (
    <div className="max-w-xl space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">Verified Tags</h2>
        <p className="text-xs text-muted-foreground">
          Tags discovered from your selected sources. Fix or remove error rows
          before continuing.
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Tag verification for the model pipeline is not wired up yet.
      </div>
    </div>
  )
}
