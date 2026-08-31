/**
 * MODEL-FLOW-011-T01: the ModelDraft reclaim eligibility predicate.
 *
 * Pure — no Prisma, no I/O — mirroring `artifact-cleanup-eligibility.ts`'s
 * own shape so this stays fully unit-testable without a database or MinIO.
 * The caller (`ModelDraftCleanupAdminService`) owns fetching `drafts` and
 * performing the writes; this module only decides.
 *
 * ModelDraft has no artifact of its own — its ModelTrainingRuns write under
 * drafts/{modelDraftId}/runs/{runId}/ instead (MODEL-FLOW-003-T08) — so this
 * predicate produces two things per eligible draft, not one: a STATUS
 * decision (flip an idle ACTIVE draft to ABANDONED) and a RECLAIM decision
 * (which run objects to delete). The two are related but not the same
 * question — an already-ABANDONED draft with unreclaimed bytes needs only
 * the second.
 *
 * TRAINED and SAVED are never eligible on any window, deliberately — see
 * this feature's own ledger findings for the measured consequence (the
 * majority of observed draft-run bytes sit under TRAINED drafts that no
 * tier here ever reaches).
 */

export type ModelDraftCleanupStatus =
  | 'ACTIVE'
  | 'TRAINED'
  | 'SAVED'
  | 'ABANDONED';
export type ModelDraftCleanupRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED';
export type ModelDraftCleanupJobStatus = ModelDraftCleanupRunStatus;

export interface ModelDraftCleanupRun {
  id: string;
  status: ModelDraftCleanupRunStatus;
  /** Set once a Model has adopted this run by pointer (MODEL-FLOW-007-T10).
   * An adopted run's objects are never named by `planReclaim` below, on
   * either branch — see MODEL-FLOW-011-T05. */
  modelId: string | null;
}

export interface ModelDraftCleanupJob {
  status: ModelDraftCleanupJobStatus;
}

export interface ModelDraftCleanupCandidate {
  id: string;
  status: ModelDraftCleanupStatus;
  /** Same convention `CleanupDraftInfo.updatedAt` documents on the dataset
   * side: Prisma's `@updatedAt` fires on every write, so this doubles as
   * "time since ACTIVE went idle" and "time since ABANDONED" with no extra
   * column. A run in flight never touches this column by itself
   * (`launchDraftRun` writes `currentRunId` at launch and nothing after) —
   * which is exactly why the in-flight checks below exist independently of
   * age. */
  updatedAt: Date;
  /** Null until this draft's run objects have been deleted — see the
   * `ModelDraft.objectsReclaimedAt` schema doc comment. */
  objectsReclaimedAt: Date | null;
  runs: readonly ModelDraftCleanupRun[];
  /** Every `ModelCandidateJob` this draft owns. Callers MAY narrow this to
   * QUEUED/RUNNING only (as the admin service's query does, for a cheaper
   * fetch) — this function re-checks status itself rather than trusting an
   * unstated caller precondition, the same "not re-checked here" tradeoff
   * `artifacts` makes explicit in the dataset-side module, just resolved
   * the other way since a wrong assumption here would delete bytes. */
  candidateJobs: readonly ModelDraftCleanupJob[];
}

export interface ModelDraftCleanupConfig {
  /** Hours of inactivity before an ACTIVE draft owning ZERO runs becomes
   * reclaim-eligible — nothing was computed, nothing is expensive to lose. */
  emptyIdleHours: number;
  /** Hours of inactivity before an ACTIVE draft owning at least one run
   * becomes reclaim-eligible — a real fit cost minutes of container time. */
  runsIdleHours: number;
  /** Hours after abandonment before an ABANDONED draft's still-unreclaimed
   * run bytes become reclaim-eligible. Applies whether the ABANDONED status
   * came from this sweep's own empty/runs tiers or from the user's own
   * Remove button (`abandonDraftService`) — either way `updatedAt` marks
   * the same "time since ABANDONED" clock. */
  abandonedRecoveryHours: number;
}

export type ModelDraftCleanupTier =
  | 'active_empty'
  | 'active_runs'
  | 'abandoned_bytes';

export type ModelDraftCleanupSkipReason =
  | 'status_not_eligible'
  | 'run_in_flight'
  | 'candidate_job_in_flight'
  | 'inside_window';

export interface ModelDraftCleanupReclaim {
  /** True when the WHOLE drafts/{draftId}/runs/ subtree should be deleted
   * in one call — chosen whenever no run on the draft is adopted
   * (`runs.every(r => r.modelId === null)`, vacuously true for an empty
   * `runs` array). Also the only shape that reaches a run prefix whose
   * `ModelTrainingRun` row no longer exists, since a per-run delete can
   * only ever name a row that still exists. */
  subtree: boolean;
  /** Run ids to reclaim individually — populated only when `subtree` is
   * false, and even then containing only the UNADOPTED runs. An adopted
   * run's id never appears here on either branch. */
  runIds: string[];
}

export interface ModelDraftCleanupEligible {
  draftId: string;
  tier: ModelDraftCleanupTier;
  reclaim: ModelDraftCleanupReclaim;
}

export interface ModelDraftCleanupReport {
  eligible: ModelDraftCleanupEligible[];
  skipped: Record<ModelDraftCleanupSkipReason, number>;
}

function hoursSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / (1000 * 60 * 60);
}

function isLive(status: ModelDraftCleanupRunStatus) {
  return status === 'QUEUED' || status === 'RUNNING';
}

/**
 * MODEL-FLOW-011-T05, expressed as data rather than a draft-level skip: a
 * draft-level "has an adopted run" check would make the guard untestable by
 * deletion (there would be nothing left to prove survives). Per-run instead:
 * subtree delete only when NOTHING on the draft is adopted; otherwise name
 * only the unadopted runs, one call each, so an adopted run's prefix is
 * never even mentioned in a reclaim request.
 */
function planReclaim(
  runs: readonly ModelDraftCleanupRun[],
): ModelDraftCleanupReclaim {
  const noneAdopted = runs.every((r) => r.modelId === null);
  if (noneAdopted) return { subtree: true, runIds: [] };
  return {
    subtree: false,
    runIds: runs.filter((r) => r.modelId === null).map((r) => r.id),
  };
}

export function reportModelDraftEligibility(
  drafts: readonly ModelDraftCleanupCandidate[],
  config: ModelDraftCleanupConfig,
  now: Date = new Date(),
): ModelDraftCleanupReport {
  const eligible: ModelDraftCleanupEligible[] = [];
  const skipped: Record<ModelDraftCleanupSkipReason, number> = {
    status_not_eligible: 0,
    run_in_flight: 0,
    candidate_job_in_flight: 0,
    inside_window: 0,
  };

  for (const draft of drafts) {
    // TRAINED/SAVED are never eligible on any window. Neither is an
    // ABANDONED draft whose bytes are already gone — both are "nothing this
    // sweep can do here", not a timing question, so both share one reason.
    if (
      draft.status === 'TRAINED' ||
      draft.status === 'SAVED' ||
      (draft.status === 'ABANDONED' && draft.objectsReclaimedAt !== null)
    ) {
      skipped.status_not_eligible += 1;
      continue;
    }

    // Applied uniformly to ACTIVE and ABANDONED alike: abandonDraftService
    // has no guard today against abandoning a draft with a run or candidate
    // job still in flight, so an ABANDONED row can reach here mid-training
    // exactly as an ACTIVE one can. Deleting run objects a container may
    // still be writing would be a race, not a cleanup.
    if (draft.runs.some((r) => isLive(r.status))) {
      skipped.run_in_flight += 1;
      continue;
    }
    if (draft.candidateJobs.some((j) => isLive(j.status))) {
      skipped.candidate_job_in_flight += 1;
      continue;
    }

    const idleHours = hoursSince(draft.updatedAt, now);

    if (draft.status === 'ABANDONED') {
      if (idleHours >= config.abandonedRecoveryHours) {
        eligible.push({
          draftId: draft.id,
          tier: 'abandoned_bytes',
          reclaim: planReclaim(draft.runs),
        });
      } else {
        skipped.inside_window += 1;
      }
      continue;
    }

    // draft.status === 'ACTIVE'
    const tier: ModelDraftCleanupTier =
      draft.runs.length === 0 ? 'active_empty' : 'active_runs';
    const threshold =
      tier === 'active_empty' ? config.emptyIdleHours : config.runsIdleHours;

    if (idleHours >= threshold) {
      eligible.push({
        draftId: draft.id,
        tier,
        reclaim: planReclaim(draft.runs),
      });
    } else {
      skipped.inside_window += 1;
    }
  }

  return { eligible, skipped };
}
