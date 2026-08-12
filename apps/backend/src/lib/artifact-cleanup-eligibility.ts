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
 *     ledger row (never deleted — see DS-LAKE-009B-T09/decisions.cleanup_scope).
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
}

function hoursSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / (1000 * 60 * 60);
}

/**
 * Returns the ids of artifacts eligible for reclaim right now.
 *
 * @param artifacts             non-FINAL candidates with `objectReclaimedAt`
 *                              already null (the caller's query does this;
 *                              not re-checked here — there is no field to
 *                              re-check against on this narrowed shape).
 * @param protectedArtifactIds  every artifact id reachable through the
 *                              parentArtifactId chain of any non-ARCHIVED
 *                              DatasetVersion's FINAL artifact.
 * @param drafts                every draft referenced by `artifacts`,
 *                              keyed by id.
 */
export function selectCleanupEligibleArtifacts(
  artifacts: readonly CleanupCandidateArtifact[],
  protectedArtifactIds: ReadonlySet<string>,
  drafts: ReadonlyMap<string, CleanupDraftInfo>,
  config: CleanupEligibilityConfig,
  now: Date = new Date(),
): string[] {
  const eligible: string[] = [];

  for (const artifact of artifacts) {
    if (artifact.type === 'FINAL') continue;

    // Hard pin — BRONZE reachable from a live (non-ARCHIVED) version can
    // never be reclaimed by age, per decisions.reproducibility_anchor.
    if (artifact.type === 'BRONZE' && protectedArtifactIds.has(artifact.id)) {
      continue;
    }

    if (!artifact.draftId) continue; // no window to measure — fail safe
    const draft = drafts.get(artifact.draftId);
    if (!draft) continue; // fail safe: no draft row to read a window from

    if (draft.status === 'ACTIVE') continue; // wizard still in progress

    if (draft.status === 'ABANDONED') {
      if (hoursSince(draft.updatedAt, now) >= config.draftRecoveryHours) {
        eligible.push(artifact.id);
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
    }
  }

  return eligible;
}
