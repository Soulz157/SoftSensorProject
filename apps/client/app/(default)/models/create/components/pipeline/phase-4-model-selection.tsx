'use client'

import { useAtomValue } from 'jotai'
import { Button } from '@/components/ui/button'
import {
  mpCandidateJobIdAtom,
  mpServerDraftIdAtom,
  mpTrainingResultAtom,
} from '@/store/model-pipeline'
import type { UsePipelineNavResult } from '@/hooks/model/use-model-pipeline-nav'
import { EmptyPanel } from './model-selection/empty-panel'
import { CandidateComparison } from './model-selection/candidate-comparison'
import { StandaloneSelection } from './model-selection/standalone-selection'

interface Props {
  nav: UsePipelineNavResult
}

/**
 * MODEL-FLOW-013, extended by MODEL-FLOW-018-T04 and MODEL-FLOW-019-T08.
 * Compares each candidate an algorithm sweep trained (Step 3's "Find Best
 * Model") and lets the user pick which one carries forward, or accept the
 * metric's own answer. `mpCandidateJobIdAtom` being null means there is no
 * CURRENT sweep to show via that path — it does NOT mean there is nothing
 * to compare: a draft whose runs were launched one at a time (including
 * every CV run, which can never belong to a sweep) now gets its own
 * comparison (`StandaloneSelection`), sourced from the draft's run list
 * rather than a job's candidates array. T08 part 4 made this ONE layout for
 * every count, including one selectable run — MODEL-FLOW-013's own
 * acceptance criterion ("a single run must not stall") is now honoured by a
 * 1-row table asking the user to choose nothing, not by a second renderer.
 *
 * This file is the composition shell only — every renderer it delegates to
 * lives under `./model-selection/`.
 */
export function Phase4ModelSelection({ nav }: Props) {
  const draftId = useAtomValue(mpServerDraftIdAtom)
  const candidateJobId = useAtomValue(mpCandidateJobIdAtom)
  const trainingResult = useAtomValue(mpTrainingResultAtom)

  if (!trainingResult) {
    return (
      <div className="space-y-4">
        <EmptyPanel>
          No training run yet — start training in Step 3 to see it here.
        </EmptyPanel>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button variant="outline" onClick={() => nav.goTo(3)}>
            Go to Training Configuration
          </Button>
        </div>
      </div>
    )
  }

  if (!candidateJobId) {
    if (!draftId) {
      return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
    }
    return <StandaloneSelection draftId={draftId} />
  }

  if (!draftId) {
    return <EmptyPanel>Model draft isn&apos;t ready yet.</EmptyPanel>
  }

  return <CandidateComparison draftId={draftId} jobId={candidateJobId} />
}
