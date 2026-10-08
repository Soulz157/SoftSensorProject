'use client'

import {
  groupAbsenceText,
  holdoutSeriesAbsenceOf,
  OOF_LOAD_FAILED_TEXT,
} from '@/lib/metric-source'
import type {
  CandidateResult,
  RunPredictionsBatchItem,
} from '@/services/model-draft'
import { CandidateOverlayChart } from './candidate-overlay-chart'

interface Props {
  /** One comparable group. */
  candidates: CandidateResult[]
  /** Test-split series, keyed by runId — fetched for the non-CV candidates. */
  byRunId: Map<string, RunPredictionsBatchItem>
  /** Out-of-fold series, keyed by runId — fetched for the CV candidates. */
  oofByRunId: Map<string, RunPredictionsBatchItem>
  /** The out-of-fold fetch's own error. Set, an empty map means "could not
   *  load", NOT "none stored" — the two need different sentences. */
  oofError?: string | null
}

/**
 * MODEL-FLOW-030. The overlay(s) for each candidate's OWN population — the
 * test split for an ordinary candidate, the out-of-fold series for a
 * cross-validated one. A CV run has no test split, so before this its "Test"
 * chart was an empty frame explaining why; it now has a real chart of its own,
 * beside Validate, laid out exactly as an ordinary run's is.
 *
 * Shared by the job path and the standalone path so the two cannot drift.
 *
 * A group of one kind renders one chart; a MIXED group renders both, each over
 * ONLY its own kind — never an out-of-fold series on a test-split chart, which
 * would be the conflation this ledger exists to prevent. A group with no
 * candidates of a kind renders no frame for it.
 */
export function OwnPopulationOverlays({
  candidates,
  byRunId,
  oofByRunId,
  oofError,
}: Props) {
  const ordinary = candidates.filter(c => !c.cvFoldsKey)
  const crossValidated = candidates.filter(c => c.cvFoldsKey)

  const structural = (group: CandidateResult[]) =>
    group.map(c => ({
      cvFoldsKey: c.cvFoldsKey,
      holdoutSeriesAbsence: holdoutSeriesAbsenceOf(c),
    }))

  return (
    <>
      {ordinary.length > 0 && (
        <CandidateOverlayChart
          candidates={ordinary}
          byRunId={byRunId}
          population="test-split"
          absenceNote={groupAbsenceText('test-split', structural(ordinary))}
        />
      )}
      {crossValidated.length > 0 && (
        <CandidateOverlayChart
          candidates={crossValidated}
          byRunId={oofByRunId}
          population="cv-oof"
          absenceNote={
            oofError
              ? OOF_LOAD_FAILED_TEXT
              : groupAbsenceText('cv-oof', structural(crossValidated))
          }
        />
      )}
    </>
  )
}
