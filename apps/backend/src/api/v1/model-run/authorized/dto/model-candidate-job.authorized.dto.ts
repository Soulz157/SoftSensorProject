import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  HyperparametersSchema,
  TrainingAlgorithmEnum,
} from './model-run.authorized.dto';

/**
 * MODEL-FLOW-005, generalized by MODEL-FLOW-013-T03. Originally "fine-tuning"
 * = a hyperparameter search: one algorithm, one artifact, one split, N
 * hyperparameter sets tried in sequence, best kept. `kind` now distinguishes
 * that shape (HYPERPARAMETER_SEARCH — every candidate repeats the same
 * algorithm) from an algorithm sweep (ALGORITHM_SWEEP, "Find Best Model" —
 * each candidate names its own). `algorithm` moved OFF the job root and INTO
 * each candidate so both kinds share one shape; targetY/goldArtifactId/
 * trainTestSplit stay on the job root — varying those would make candidates
 * incomparable.
 */
export const CandidateSchema = z
  .object({
    algorithm: TrainingAlgorithmEnum,
    hyperparameters: HyperparametersSchema,
  })
  .strict();

export const CandidateJobKindEnum = z.enum([
  'HYPERPARAMETER_SEARCH',
  'ALGORITHM_SWEEP',
  'SWEEP_THEN_TUNE',
]);

export const CreateCandidateJobSchema = z
  .object({
    goldArtifactId: z.string().uuid(),
    targetY: z.string().min(1).max(255),
    trainTestSplit: z.coerce.number().min(0.5).max(0.95).optional(),
    kind: CandidateJobKindEnum,

    // At least 1 for HYPERPARAMETER_SEARCH — a single algorithm + its
    // current hyperparameters, expanded server-side into the curated
    // TUNING_GRID variants by createJob (tuning-grid.ts's own grid stays
    // the one place this shortlist is declared, never duplicated
    // client-side). ALGORITHM_SWEEP/SWEEP_THEN_TUNE keep requiring 2 — one
    // candidate there is not a sweep, it is a normal training run
    // (createDraftRunService already exists for that) — enforced by the
    // .refine() below since the bare array bound can no longer say it.
    // Capped well below MIN_LABELLED_ROWS-scale concerns: this is a count
    // of CONTAINER spawns, and an unbounded list would let one request
    // queue an unbounded amount of compute with no review point.
    candidates: z.array(CandidateSchema).min(1).max(20),

    // MODEL-FLOW-020-T04/T02. The dataset's two size figures, carried from
    // the /split-stats response Step 3 has ALREADY fetched — `sizedRowCount`
    // is that response's `source_rows`, `sizedDistinctLabelled` its
    // `distinct_labelled_values`. Those two specifically because they are
    // the only fields /split-stats guarantees in BOTH ratio and CV mode.
    // Before Apply (and for lstm/gru, which never fetch it) `sizedRowCount`
    // is instead the saved dataset's own row count, sent alone
    // (MODEL-FLOW-024-T10).
    //
    // ACCEPTED FROM THE CLIENT rather than read here, which is unusual
    // enough in this file to state plainly: `distinct_labelled_values`
    // requires a FULL artifact read, and
    // model-run-launch.authorized.service.ts:174-182 already carries a
    // reasoned refusal to add one to the launch path. The client is the only
    // participant that has these free. They were RECORD, never authority,
    // until MODEL-FLOW-024 settled the question this comment used to leave
    // open: `sizedRowCount` now picks the tuning grid's size tier and the
    // LSTM/GRU batch-size band (the user chose a row-count tier on
    // 2026-09-21; `sizedDistinctLabelled` is recorded but picks nothing). A
    // client-supplied figure is trusted for that, and only that, because it selects among
    // fixed declared variant lists and grants nothing the client cannot
    // already do by sending arbitrary hyperparameters itself. The figures are
    // stored on the job row so a later reader can recompute which tier a
    // job's phase 2 was built from.
    //
    // Both optional: a job started before the user pressed Apply on Step 3
    // genuinely has no figures to send (the panel's fetch is Apply-gated),
    // and null there is the honest answer rather than a blocked request.
    sizedRowCount: z.number().int().nonnegative().optional(),
    sizedDistinctLabelled: z.number().int().nonnegative().optional(),

    // MODEL-FLOW-026. Hyperparameter sets the USER added by hand in Step 3's
    // variant table, tried IN ADDITION to the curated TUNING_GRID shortlist
    // rather than instead of it — the grid stays declared in exactly one
    // place (tuning-grid.ts) and keeps its own TUNE_VARIANTS_PER_JOB cap;
    // these are appended after it by `createJob`, which also drops any that
    // the base or a grid variant already covers so a hand-typed duplicate
    // cannot buy a second identical fit.
    //
    // HYPERPARAMETER_SEARCH ONLY, and refused otherwise below. A
    // SWEEP_THEN_TUNE job builds its phase 2 in `advanceJobForRun` long
    // after this request has returned, reading the JOB ROW — it cannot see a
    // field that was never stored, and silently accepting one here would
    // promise a search that never runs. Storing them would take a schema
    // migration; that is a separate decision, not something to smuggle in
    // behind an optional field.
    //
    // Capped at 8 for the same reason `candidates` is capped at 20: each
    // entry is a CONTAINER spawn. Values are scalar-constrained by the same
    // `HyperparametersSchema` every other hyperparameter record here uses,
    // so this grants nothing a client could not already do by sending
    // arbitrary hyperparameters on a candidate.
    extraVariants: z.array(HyperparametersSchema).max(8).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.extraVariants === undefined ||
      data.extraVariants.length === 0 ||
      data.kind === 'HYPERPARAMETER_SEARCH',
    {
      message:
        'extraVariants is only supported for a HYPERPARAMETER_SEARCH — a sweep builds its tuning phase after the winner is known, from the job row.',
      path: ['extraVariants'],
    },
  )
  .refine(
    (data) =>
      data.kind === 'HYPERPARAMETER_SEARCH' || data.candidates.length >= 2,
    {
      message:
        'ALGORITHM_SWEEP/SWEEP_THEN_TUNE need at least 2 candidates — one candidate is a normal training run, not a sweep.',
      path: ['candidates'],
    },
  )
  // DISTINCT NEEDS ROWS, BUT NOT THE REVERSE. The pair exists to show a
  // reader how far apart the two figures are (on this system's own data, up
  // to 260x), so a distinct count with no row count beside it carries no such
  // comparison and would read as a captured job whose other half was lost —
  // refused here rather than silently nulled. Rows WITHOUT a distinct count is
  // allowed since MODEL-FLOW-024: the split-stats fetch is never made while
  // lstm/gru is selected (a ratio split means nothing for windows), so a
  // sequence job has a row count from the dataset but no distinct count to
  // send — and rows is the figure the size tier and LSTM/GRU `batch_size`
  // key on, so that job is still sized.
  .refine(
    (data) =>
      data.sizedDistinctLabelled === undefined ||
      data.sizedRowCount !== undefined,
    {
      message:
        'sizedDistinctLabelled cannot be sent without sizedRowCount — a distinct count with no row count beside it cannot show how far the two figures diverge.',
      path: ['sizedDistinctLabelled'],
    },
  );

export class CreateCandidateJobDto extends createZodDto(
  CreateCandidateJobSchema,
) {}

/**
 * MODEL-FLOW-013-T08. `runId` must be one of the job's own SUCCEEDED
 * candidates and the job must be terminal — both enforced in the service,
 * not here, since they need a DB read. Writes ONLY
 * ModelCandidateJob.selectedRunId; ModelDraft.currentRunId keeps its
 * existing single writer (advanceJobForRun's completion branch),
 * untouched by this route.
 */
export const SelectCandidateSchema = z
  .object({
    runId: z.string().uuid(),
  })
  .strict();

export class SelectCandidateDto extends createZodDto(SelectCandidateSchema) {}
