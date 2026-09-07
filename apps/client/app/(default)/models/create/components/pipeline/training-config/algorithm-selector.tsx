'use client'

import { Plus, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ALGORITHMS,
  ALGORITHM_LABELS,
  type Algorithm,
} from '@/store/model-pipeline'

const MAX = 3

/**
 * Algorithms the trainer can't run yet (images/trainer/train.py `build_model`
 * — needs a windowed 3D input the pipeline doesn't build). Disabled here so
 * the refusal is where the choice is made, not three layers downstream at
 * run creation (MODEL-FLOW-003-T10). Neutral/muted styling only — red/amber
 * are reserved for workspace and plant status, not catalogue availability.
 *
 * MODEL-FLOW-009-T04. lstm/gru's entries removed — the trainer now builds
 * a windowed 3D input (build_windows) and has a real torch runtime
 * (sequence_model.py). Left empty rather than deleted so a future
 * algorithm gap has the same mechanism to reuse.
 */
const DEFERRED_REASON: Partial<Record<Algorithm, string>> = {}

/**
 * MODEL-FLOW-020-T06. MIRRORS `GPR_MAX_TRAIN_ROWS` in
 * `images/trainer/app/models.py` — the measured ceiling above which
 * `build_model` refuses Gaussian Process outright (an n x n kernel matrix,
 * O(n^3) to fit, against that container's memory limit). The number is
 * measured THERE and only echoed here; if it moves, it moves there first.
 * Same mirror discipline `images/trainer/app/MIRRORS.md` records for
 * `MIN_LABELS_PER_FOLD`, the closest existing precedent for a constant this
 * side needs a copy of.
 *
 * WHY A COPY AT ALL: `grp` had 0 runs of 175 in this system when
 * MODEL-FLOW-020-T01 measured it, so this refusal had never once fired —
 * while the largest artifact on hand was 46,070 rows. Reaching it costs a
 * container spawn, an artifact download and a queue slot, to be told
 * something knowable the moment the algorithm is ticked.
 *
 * KEYED ON ROWS, DELIBERATELY — the one place in this feature that is.
 * MODEL-FLOW-020 keys capacity decisions on distinct labelled observations,
 * never row count. This is not a capacity bound but a RESOURCE ceiling:
 * bytes of kernel matrix, and bytes scale with rows however few distinct
 * values those rows hold. See that feature's own openDecisions entry for the
 * amendment recording the distinction.
 */
const GPR_MAX_TRAIN_ROWS = 10_000

interface Props {
  algorithms: Algorithm[]
  onChange: (algorithms: Algorithm[]) => void
  /**
   * MODEL-FLOW-020-T06. The TRAIN-split labelled row count `/split-stats`
   * reports, which is precisely the `n_train_rows` `build_model` measures
   * `GPR_MAX_TRAIN_ROWS` against — not the artifact's raw row count, which
   * is larger and would refuse datasets that actually fit.
   *
   * `null` whenever that figure is unknown: before Apply, and in CV mode,
   * where there is no single train split (`train_labelled_rows` is null by
   * construction). No refusal is offered then — the trainer's own fit-time
   * backstop still fires, and refusing on a number this component does not
   * have would be a guess wearing a limit.
   */
  trainLabelledRows: number | null
}

/**
 * Multi-select algorithm picker (up to 3). The first selected is the primary
 * (drives the manual hyperparameter grid). At least one must stay selected.
 */
export function AlgorithmSelector({
  algorithms,
  onChange,
  trainLabelledRows,
}: Props) {
  const atCap = algorithms.length >= MAX

  /**
   * MODEL-FLOW-020-T06. Why an algorithm cannot be picked for THIS dataset,
   * as opposed to `DEFERRED_REASON`'s "cannot be run at all". Merged into one
   * lookup below so the dropdown keeps exactly one notion of unavailable —
   * a second disabled path with its own copy would drift from this one.
   */
  const oversizedReason: Partial<Record<Algorithm, string>> =
    trainLabelledRows !== null && trainLabelledRows > GPR_MAX_TRAIN_ROWS
      ? {
          grp:
            `Needs a ${trainLabelledRows.toLocaleString()} x ` +
            `${trainLabelledRows.toLocaleString()} kernel matrix — over the ` +
            `measured ${GPR_MAX_TRAIN_ROWS.toLocaleString()}-row ceiling for ` +
            `the training container. Try Random Forest, LightGBM or XGBoost.`,
        }
      : {}

  const toggle = (a: Algorithm, on: boolean) => {
    if (on) {
      if (atCap || algorithms.includes(a)) return
      onChange([...algorithms, a])
    } else {
      if (algorithms.length <= 1) return // keep at least one
      onChange(algorithms.filter(x => x !== a))
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">
        Algorithms{' '}
        <span className="text-muted-foreground">
          ({algorithms.length}/{MAX})
        </span>
      </Label>

      <div className="flex flex-wrap items-center gap-1.5">
        {algorithms.map((a, i) => (
          <span
            key={a}
            className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
          >
            {i === 0 && (
              <span className="text-[10px] font-semibold uppercase opacity-70">
                primary
              </span>
            )}
            {ALGORITHM_LABELS[a]}
            <button
              type="button"
              onClick={() => toggle(a, false)}
              disabled={algorithms.length <= 1}
              aria-label={`Remove ${ALGORITHM_LABELS[a]}`}
              className="rounded-full p-0.5 transition-colors hover:bg-primary/20 disabled:opacity-40"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              disabled={atCap}
            >
              <Plus className="h-3.5 w-3.5" />
              Add algorithm
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-full">
            <DropdownMenuLabel>Select up to {MAX}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALGORITHMS.map(a => {
              const checked = algorithms.includes(a)
              // DEFERRED_REASON first: "the trainer cannot run this at all"
              // outranks "this dataset is too big for it" when both apply.
              const deferredReason = DEFERRED_REASON[a] ?? oversizedReason[a]
              return (
                <DropdownMenuCheckboxItem
                  key={a}
                  checked={checked}
                  disabled={
                    // deferredReason only blocks SELECTING it — a hydrated
                    // draft that already carries a deferred algorithm must
                    // still be able to uncheck it here, subject to the same
                    // "keep at least one" rule every algorithm follows.
                    (!checked && Boolean(deferredReason)) ||
                    (!checked && atCap) ||
                    (checked && algorithms.length <= 1)
                  }
                  onCheckedChange={on => toggle(a, on)}
                  className="cursor-pointer"
                >
                  <span className="flex flex-col">
                    <span>{ALGORITHM_LABELS[a]}</span>
                    {deferredReason && (
                      <span className="text-[10px] text-muted-foreground">
                        {deferredReason}
                      </span>
                    )}
                  </span>
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
