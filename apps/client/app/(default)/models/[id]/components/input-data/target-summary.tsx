'use client'

interface Props {
  targetY: string
  version: number
  stage: 'STAGING' | 'PRODUCTION' | 'ARCHIVED'
  /** The wizard's own copy (`Model.data.config.targetVariables`), when it
   *  disagrees with `targetY` — shown so the disagreement is visible
   *  rather than silently resolved by picking one. */
  configuredTargets: string[]
}

/**
 * The Y row for the Input Data tab — rendered above the X feature table,
 * visually separated rather than as a row inside it. `targetY` is the
 * TRAINED target (`ModelTrainingRun.targetY`, one column); it can disagree
 * with the wizard's `targetVariables[]` copy, so both are shown rather
 * than silently picking one.
 */
export function TargetSummary({
  targetY,
  version,
  stage,
  configuredTargets,
}: Props) {
  const extraConfigured = configuredTargets.filter(t => t !== targetY)

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Trained target
        </span>
        <span className="font-mono text-sm font-medium text-foreground">
          {targetY}
        </span>
        <span
          title="Target (Y) — what this model was trained to predict"
          className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          Y
        </span>
        <span className="text-xs text-muted-foreground">
          · from version {version} · {stage}
        </span>
      </div>
      {extraConfigured.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Configured target{extraConfigured.length === 1 ? '' : 's'} on this
          model differ from the trained target:{' '}
          <span className="font-mono">{extraConfigured.join(', ')}</span>
        </p>
      )}
    </div>
  )
}
