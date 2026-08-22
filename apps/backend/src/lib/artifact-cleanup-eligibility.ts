/**
 * DS-LAKE-009B-T08: the intermediate-artifact cleanup eligibility predicate.
 *
 * Pure — no Prisma, no I/O — so it is fully unit-testable without a database
 * or MinIO. Callers (`ArtifactCleanupService`) own fetching `artifacts`,
 * `protectedArtifactIds` and `drafts`; this module only decides.
 *
 * Reconciling T08's prose with `decisions.reproducibility_anchor` and
 * acceptance criteria V01/V06 (feature_list.preprocessing.json):
 *
 *   - Reachability through a non-ARCHIVED DatasetVersion's parentArtifactId
 *     chain is a HARD PIN for BRONZE only — age can never override it.
 *   - SILVER and GOLD stay age-releasable even while reachable, because they
 *     are re-derivable from BRONZE plus the operations recorded on their own
 *     ledger row (never deleted — see DS-LAKE-009B-T09/decisions.cleanup_scope) —
 *     EXCEPT the one SILVER or GOLD artifact directly promoted to a live
 *     FINAL. `promoteDraftArtifactToFinalService` never copies bytes: FINAL
 *     is written with `objectKey: source.objectKey`, literally the same
 *     MinIO object as its promoted parent (ADR-DS-LAKE-005B-B-006, "by
 *     reference — never a byte copy"). Reclaiming that specific parent
 *     deletes the FINAL's own readable bytes — the FINAL row survives
 *     untouched in Postgres but 404s from MinIO, which is a WORSE failure
 *     than a missing row because nothing signals the loss. Found and fixed
 *     during DS-LAKE-012's end-to-end verification (2026-08-17): the
 *     existing predicate correctly protected BRONZE via `protectedArtifactIds`
 *     but never applied the same protection to a promoted SILVER/GOLD,
 *     because the "re-derivable, so age-releasable" reasoning above is true
 *     for every OTHER SILVER/GOLD in the chain, just not for the one FINAL
 *     is literally reading from right now.
 *
 * A uniform "reachable ⇒ pinned" reading of T08 would pin BRONZE, SILVER and
 * GOLD alike and make cleanup a no-op for every saved dataset — V01 requires
 * "eligible intermediate artifacts are eventually reclaimed" for a saved
 * dataset, which a uniform pin cannot satisfy except vacuously. V06 only
 * asserts the BRONZE object survives past every retention window and that
 * archiving releases the pin — it says nothing about SILVER/GOLD surviving.
 * T08's sentence is arguing against a DIRECT-reference check (which is what
 * leaves BRONZE deletable in the first place — the dangling-pointer defect
 * it names), not asking to pin the whole chain.
 *
 * FINAL is never a candidate here — the caller filters it out (and it is
 * filtered again below, defensively): the adopted FINAL is retained per the
 * dataset lifecycle, not this path (DS-LAKE-009B's own acceptance
 * criterion: "No FINAL artifact is deleted by the intermediate-artifact
 * cleanup path"). Read literally, that also covers an UNADOPTED FINAL
 * belonging to a draft that was abandoned before ever calling Save — a
 * known, deliberate gap: no acceptance criterion or verification item
 * requires reclaiming it, and leaving orphaned FINAL bytes alone is the
 * safer default for an operation that cannot be undone.
 */

export type CleanupArtifactType = 'BRONZE' | 'SILVER' | 'GOLD' | 'FINAL';
export type CleanupDraftStatus = 'ACTIVE' | 'SAVED' | 'ABANDONED';

export interface CleanupCandidateArtifact {
  id: string;
  type: CleanupArtifactType;
  /** Every non-FINAL artifact is draft-owned for its whole life — only
   * FINAL ever gets `datasetId` set (adopted by pointer at Save, `draftId`
   * kept for traceability). Null here means there is no basis to release
   * the artifact and it is treated as ineligible. */
  draftId: string | null;
  // No `createdAt` here on purpose. Both branches below measure age from
  // the DRAFT's `updatedAt`, never the artifact's own `createdAt` — see
  // `CleanupDraftInfo.updatedAt`'s doc comment for why: the retention
  // window is a promise made about time SINCE the draft's status changed
  // (abandonment, or Save), not about how long ago the wizard happened to
  // write the bytes.
}

export interface CleanupDraftInfo {
  status: CleanupDraftStatus;
  /**
   * The draft's own last write time — doubles as "time since [status]" for
   * BOTH branches below, with no extra column, because Prisma's `@updatedAt`
   * fires on every write to the row:
   *
   *   - ABANDONED: `abandonDraftService` writes `status: 'ABANDONED'`, so
   *     this is time since abandonment.
   *   - SAVED: `saveDraftAsDatasetService`'s $transaction writes
   *     `{savedDatasetId, status: 'SAVED'}` (dataset-draft.authorized.
   *     service.ts:777-780), so this is time since Save — NOT time since
   *     the wizard originally wrote the artifact. Using the artifact's own
   *     `createdAt` here was a real bug caught before ship: a user who
   *     spends days iterating in the wizard before clicking Save would have
   *     artifacts already past the retention window at the moment Save
   *     runs, so the very first cleanup pass after Save would reclaim them
   *     with ZERO of the recovery window T01 exists to guarantee.
   *
   * A draft abandoned AFTER being saved (an edge case `abandonDraftService`
   * does not currently guard against) is treated the same as any other
   * ABANDONED draft — the BRONZE pin above is what actually protects a
   * still-referenced chain regardless of this branch. Nothing else writes a
   * draft row after Save as of this feature, so the SAVED clock does not
   * reset out from under this guarantee; if a future change adds a
   * post-Save draft write, the effect is a longer (safer-direction) window,
   * never a shorter one.
   */
  updatedAt: Date;
}

export interface CleanupEligibilityConfig {
  /** Hours after abandonment before an ABANDONED draft's own artifacts are
   * reclaim-eligible (DS-LAKE-009B-T05). */
  draftRecoveryHours: number;
  /** Hours after creation before a SAVED draft's leftover BRONZE/SILVER/GOLD
   * siblings (everything except the adopted FINAL) are reclaim-eligible. */
  intermediateRetentionHours: number;
  /**
   * DS-LAKE-014-T02: hours of inactivity (measured from `draft.updatedAt`)
   * before an ACTIVE draft's own artifacts become reclaim-eligible.
   *
   * Reaching the ACTIVE branch below always means the draft owns at least
   * one LIVE artifact — the one currently being iterated — so this is
   * unconditionally the artifact-BEARING tier (a real PI fetch cost minutes;
   * an engineer may return to it). The artifact-LESS tier
   * (`CLEANUP_ACTIVE_EMPTY_MINUTES`) is a separate, draft-level status
   * transition to ABANDONED, handled by the sweep caller
   * (`ArtifactCleanupAdminService`), never by this predicate — a draft with
   * zero live artifacts produces zero candidate rows here and can never
   * reach this function at all.
   */
  activeIdleHours: number;
}

function hoursSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / (1000 * 60 * 60);
}

/** DS-LAKE-014-T05: why a non-eligible artifact was skipped, so a sweep that
 * reclaims nothing is distinguishable from a sweep that found nothing.
 * `active_job` is NOT one of these — it is a live-reference check the caller
 * (`ArtifactCleanupAdminService`) makes on top of this predicate's eligible
 * set, since an active `PreprocessingJob` reference has nothing to do with
 * age or lineage. FINAL artifacts are filtered before this loop and are not
 * attributed to any reason — they were never candidates to begin with. */
export type CleanupSkipReason =
  | 'lineage_pinned'
  | 'shared_final_object'
  | 'no_draft'
  | 'inside_window';

export interface CleanupEligibilityReport {
  eligible: string[];
  skipped: Record<CleanupSkipReason, number>;
}

/**
 * DS-LAKE-014-T05: the same decision as `selectCleanupEligibleArtifacts`
 * below, but additionally attributing every non-eligible artifact to exactly
 * one `CleanupSkipReason`. `selectCleanupEligibleArtifacts` is a thin
 * delegate to this function that keeps its ORIGINAL signature and return
 * type — this function is purely additive so DS-LAKE-009B-T08's existing
 * unit tests keep passing unmodified.
 *
 * @param artifacts             non-FINAL candidates with `objectReclaimedAt`
 *                              already null (the caller's query does this;
 *                              not re-checked here — there is no field to
 *                              re-check against on this narrowed shape).
 * @param protectedArtifactIds  every artifact id reachable through the
 *                              parentArtifactId chain of any non-ARCHIVED
 *                              DatasetVersion's FINAL artifact.
 * @param objectKeySharedWithFinalIds  the ONE artifact per live (non-ARCHIVED)
 *                              DatasetVersion that was directly promoted to
 *                              its FINAL — i.e. `version.artifact.parentArtifactId`.
 *                              Reclaiming it deletes the FINAL's own bytes
 *                              (see the module doc comment). Hard-pinned
 *                              regardless of type, unlike `protectedArtifactIds`
 *                              which only hard-pins BRONZE.
 * @param drafts                every draft referenced by `artifacts`,
 *                              keyed by id.
 */
export function reportCleanupEligibility(
  artifacts: readonly CleanupCandidateArtifact[],
  protectedArtifactIds: ReadonlySet<string>,
  drafts: ReadonlyMap<string, CleanupDraftInfo>,
  config: CleanupEligibilityConfig,
  now: Date = new Date(),
  objectKeySharedWithFinalIds: ReadonlySet<string> = new Set(),
): CleanupEligibilityReport {
  const eligible: string[] = [];
  const skipped: Record<CleanupSkipReason, number> = {
    lineage_pinned: 0,
    shared_final_object: 0,
    no_draft: 0,
    inside_window: 0,
  };

  for (const artifact of artifacts) {
    if (artifact.type === 'FINAL') continue;

    // Hard pin — BRONZE reachable from a live (non-ARCHIVED) version can
    // never be reclaimed by age, per decisions.reproducibility_anchor.
    if (artifact.type === 'BRONZE' && protectedArtifactIds.has(artifact.id)) {
      skipped.lineage_pinned += 1;
      continue;
    }

    // Hard pin — this exact artifact's bytes ARE a live FINAL's bytes
    // (shared objectKey, never copied). Type-agnostic on purpose: this can
    // be a SILVER (features step skipped) or a GOLD (the common case), and
    // either would otherwise fall through to the age-releasable branch
    // below. See the module doc comment for the full incident.
    if (objectKeySharedWithFinalIds.has(artifact.id)) {
      skipped.shared_final_object += 1;
      continue;
    }

    if (!artifact.draftId) {
      skipped.no_draft += 1; // no window to measure — fail safe
      continue;
    }
    const draft = drafts.get(artifact.draftId);
    if (!draft) {
      skipped.no_draft += 1; // fail safe: no draft row to read a window from
      continue;
    }

    if (draft.status === 'ACTIVE') {
      // DS-LAKE-014: deliberate reversal of DS-LAKE-009B's unconditional
      // `continue` that used to sit here (recorded verbatim in this
      // feature's T01 result). Reaching this branch means the draft owns at
      // least one LIVE artifact — see `activeIdleHours`'s doc comment above
      // for why that makes this unconditionally the expensive tier.
      if (hoursSince(draft.updatedAt, now) >= config.activeIdleHours) {
        eligible.push(artifact.id);
      } else {
        skipped.inside_window += 1;
      }
      continue;
    }

    if (draft.status === 'ABANDONED') {
      if (hoursSince(draft.updatedAt, now) >= config.draftRecoveryHours) {
        eligible.push(artifact.id);
      } else {
        skipped.inside_window += 1;
      }
      continue;
    }

    // draft.status === 'SAVED': a leftover sibling of the adopted FINAL.
    // SILVER/GOLD release by age alone, even if still lineage-reachable —
    // BRONZE reaches here only when NOT protected (the pin above already
    // filtered the protected case out). Measured from Save time
    // (draft.updatedAt), not artifact.createdAt — see CleanupDraftInfo's
    // doc comment for why the wizard's own write time is the wrong clock.
    if (hoursSince(draft.updatedAt, now) >= config.intermediateRetentionHours) {
      eligible.push(artifact.id);
    } else {
      skipped.inside_window += 1;
    }
  }

  return { eligible, skipped };
}

/**
 * Returns the ids of artifacts eligible for reclaim right now. Thin delegate
 * to `reportCleanupEligibility` — kept as a separate export with its
 * original signature so existing callers and tests are unaffected by
 * DS-LAKE-014-T05's per-reason reporting.
 *
 * @param artifacts             non-FINAL candidates with `objectReclaimedAt`
 *                              already null (the caller's query does this;
 *                              not re-checked here — there is no field to
 *                              re-check against on this narrowed shape).
 * @param protectedArtifactIds  every artifact id reachable through the
 *                              parentArtifactId chain of any non-ARCHIVED
 *                              DatasetVersion's FINAL artifact.
 * @param objectKeySharedWithFinalIds  the ONE artifact per live (non-ARCHIVED)
 *                              DatasetVersion that was directly promoted to
 *                              its FINAL — i.e. `version.artifact.parentArtifactId`.
 *                              Reclaiming it deletes the FINAL's own bytes
 *                              (see the module doc comment). Hard-pinned
 *                              regardless of type, unlike `protectedArtifactIds`
 *                              which only hard-pins BRONZE.
 * @param drafts                every draft referenced by `artifacts`,
 *                              keyed by id.
 */
export function selectCleanupEligibleArtifacts(
  artifacts: readonly CleanupCandidateArtifact[],
  protectedArtifactIds: ReadonlySet<string>,
  drafts: ReadonlyMap<string, CleanupDraftInfo>,
  config: CleanupEligibilityConfig,
  now: Date = new Date(),
  objectKeySharedWithFinalIds: ReadonlySet<string> = new Set(),
): string[] {
  return reportCleanupEligibility(
    artifacts,
    protectedArtifactIds,
    drafts,
    config,
    now,
    objectKeySharedWithFinalIds,
  ).eligible;
}
