import {
  selectCleanupEligibleArtifacts,
  reportCleanupEligibility,
  type CleanupCandidateArtifact,
  type CleanupDraftInfo,
} from './artifact-cleanup-eligibility';

/**
 * DS-LAKE-009B-T08. This is where all the risk in the cleanup feature
 * lives — a wrong answer here means either real bytes an audit needs are
 * deleted, or cleanup silently never reclaims anything. Every acceptance
 * criterion this predicate is responsible for (V01, V02's draft half, V04,
 * V06) is pinned directly here, without needing Postgres or MinIO.
 */

const NOW = new Date('2026-08-12T00:00:00.000Z');
const CONFIG = {
  draftRecoveryHours: 168,
  intermediateRetentionHours: 168,
  activeIdleHours: 6,
};

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function artifact(
  overrides: Partial<CleanupCandidateArtifact> & { id: string },
): CleanupCandidateArtifact {
  return {
    type: 'BRONZE',
    draftId: 'draft-1',
    // Irrelevant to every BRONZE/SILVER/GOLD/FINAL case below — only the
    // EXPORT branch reads this. A fixed default keeps those tests from
    // having to supply a value they don't care about.
    createdAt: NOW,
    // DS-LAKE-024-T05. Derived from `id` so every existing test keeps a
    // UNIQUE key by default (no accidental protectedObjectKeys collision
    // between unrelated artifacts) — a test asserting a real shared-key
    // pin passes an explicit `objectKey` override to force the collision.
    objectKey: `${overrides.id}/data.parquet`,
    ...overrides,
  };
}

function drafts(entries: Record<string, CleanupDraftInfo>) {
  return new Map(Object.entries(entries));
}

describe('selectCleanupEligibleArtifacts', () => {
  it('never selects a FINAL artifact, regardless of age or draft state', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'final-1', type: 'FINAL' })],
      new Set(),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(10_000) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('pins a lineage-reachable BRONZE forever, no matter how old the draft is', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1', type: 'BRONZE' })],
      new Set(['bronze-1']),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(100_000) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('releases a BRONZE once it is no longer lineage-reachable and the SAVED window has cleared', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1', type: 'BRONZE' })],
      new Set(), // not reachable — e.g. the version was archived
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(200) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual(['bronze-1']);
  });

  it('releases SILVER/GOLD by age alone, even while still lineage-reachable', () => {
    const result = selectCleanupEligibleArtifacts(
      [
        artifact({ id: 'silver-1', type: 'SILVER' }),
        artifact({ id: 'gold-1', type: 'GOLD' }),
      ],
      new Set(['silver-1', 'gold-1']), // reachable, but type isn't BRONZE
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(200) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual(['silver-1', 'gold-1']);
  });

  it('keeps a SAVED draft artifact ineligible until it clears the retention window', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'silver-1', type: 'SILVER' })],
      new Set(),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(1) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('regression: measures the SAVED window from Save time, not from when the wizard wrote the artifact', () => {
    // The bug this guards against: a user spends days iterating in the
    // wizard before clicking Save. The artifact's own age is irrelevant —
    // only "how long since Save" may determine eligibility, or a slow
    // wizard session gets ZERO post-Save recovery window.
    const justSaved = selectCleanupEligibleArtifacts(
      [artifact({ id: 'silver-1', type: 'SILVER' })],
      new Set(),
      // Save happened 1 hour ago — well inside the window — even though
      // nothing about the artifact's own history is provided at all (the
      // type no longer carries a createdAt to accidentally fall back on).
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(1) } }),
      CONFIG,
      NOW,
    );
    expect(justSaved).toEqual([]);

    const longAfterSave = selectCleanupEligibleArtifacts(
      [artifact({ id: 'silver-1', type: 'SILVER' })],
      new Set(),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(200) } }),
      CONFIG,
      NOW,
    );
    expect(longAfterSave).toEqual(['silver-1']);
  });

  it('DS-LAKE-014: keeps an ACTIVE draft artifact ineligible before the idle window elapses', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1' })],
      new Set(),
      drafts({ 'draft-1': { status: 'ACTIVE', updatedAt: hoursAgo(1) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('DS-LAKE-014: reclaims an ACTIVE draft artifact once past the idle window (reversal of the old unconditional skip)', () => {
    // Prior behaviour, deleted by this feature: `if (status === 'ACTIVE')
    // continue;` unconditionally, however old the draft row was — the exact
    // bug DS-LAKE-014-T01 recorded before changing it.
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1' })],
      new Set(),
      drafts({ 'draft-1': { status: 'ACTIVE', updatedAt: hoursAgo(100_000) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual(['bronze-1']);
  });

  it('reclaims an ABANDONED draft artifact once past the recovery window', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1' })],
      new Set(),
      drafts({ 'draft-1': { status: 'ABANDONED', updatedAt: hoursAgo(200) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual(['bronze-1']);
  });

  it('keeps an ABANDONED draft artifact ineligible before the recovery window elapses', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1' })],
      new Set(),
      drafts({ 'draft-1': { status: 'ABANDONED', updatedAt: hoursAgo(1) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('fails safe when the owning draft row cannot be found', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1', draftId: 'ghost-draft' })],
      new Set(),
      drafts({}),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('fails safe when an artifact has no draftId to measure a window from', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1', draftId: null })],
      new Set(),
      drafts({}),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('handles a full BRONZE→SILVER→GOLD→FINAL saved chain in one pass (V06)', () => {
    const chain: CleanupCandidateArtifact[] = [
      artifact({ id: 'bronze-1', type: 'BRONZE' }),
      artifact({ id: 'silver-1', type: 'SILVER' }),
      artifact({ id: 'gold-1', type: 'GOLD' }),
      artifact({ id: 'final-1', type: 'FINAL' }),
    ];
    const abandonedSibling = artifact({
      id: 'abandoned-bronze',
      draftId: 'draft-2',
    });

    // version not archived yet — walking parentArtifactId from FINAL reaches all three
    const reachable = new Set(['final-1', 'gold-1', 'silver-1', 'bronze-1']);
    // gold-1 is FINAL's direct promoted parent — shares its objectKey.
    const objectKeySharedWithFinal = new Set(['gold-1']);

    const before = selectCleanupEligibleArtifacts(
      [...chain, abandonedSibling],
      reachable,
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        'draft-2': { status: 'ABANDONED', updatedAt: hoursAgo(500) },
      }),
      CONFIG,
      NOW,
      objectKeySharedWithFinal,
    );
    // BRONZE survives (pinned); gold-1 survives (shares FINAL's bytes);
    // SILVER (a genuine ancestor, not the direct parent) and the abandoned
    // sibling reclaim; FINAL never touched.
    expect(before.sort()).toEqual(['abandoned-bronze', 'silver-1'].sort());

    // Now the version is ARCHIVED — nothing is reachable or FINAL-shared any
    // more, so BRONZE and gold-1 both release too.
    const after = selectCleanupEligibleArtifacts(
      [...chain, abandonedSibling],
      new Set(),
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        'draft-2': { status: 'ABANDONED', updatedAt: hoursAgo(500) },
      }),
      CONFIG,
      NOW,
      new Set(),
    );
    expect(after.sort()).toEqual(
      ['abandoned-bronze', 'bronze-1', 'gold-1', 'silver-1'].sort(),
    );
  });

  it('DS-LAKE-021-T04: reclaims an EXPORT artifact once past its retention window, with no draft involved at all', () => {
    // EXPORT belongs to a SAVED dataset, never a draft — draftId is always
    // null, and no draft entry is supplied here at all, proving the
    // no_draft fail-safe never gets a chance to reject it.
    const result = selectCleanupEligibleArtifacts(
      [
        artifact({
          id: 'export-1',
          type: 'EXPORT',
          draftId: null,
          createdAt: hoursAgo(200),
        }),
      ],
      new Set(),
      drafts({}),
      CONFIG,
      NOW,
    );
    expect(result).toEqual(['export-1']);
  });

  it('DS-LAKE-021-T04: keeps an EXPORT artifact ineligible before its retention window elapses', () => {
    const result = selectCleanupEligibleArtifacts(
      [
        artifact({
          id: 'export-1',
          type: 'EXPORT',
          draftId: null,
          createdAt: hoursAgo(1),
        }),
      ],
      new Set(),
      drafts({}),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('regression (DS-LAKE-012): never reclaims the SILVER/GOLD artifact directly promoted to a live FINAL, even though it is normally age-releasable', () => {
    // promoteDraftArtifactToFinalService writes FINAL with the SAME
    // objectKey as its source — reclaiming that source deletes FINAL's own
    // bytes even though the FINAL row and protectedArtifactIds walk both
    // look untouched. This is true whether the promoted source is a GOLD
    // (the common case) or a SILVER (features step skipped).
    const goldCase = selectCleanupEligibleArtifacts(
      [artifact({ id: 'gold-1', type: 'GOLD' })],
      new Set(), // not reachable via the generic walk — irrelevant here
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) } }),
      CONFIG,
      NOW,
      new Set(['gold-1']),
    );
    expect(goldCase).toEqual([]);

    const silverCase = selectCleanupEligibleArtifacts(
      [artifact({ id: 'silver-1', type: 'SILVER' })],
      new Set(),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) } }),
      CONFIG,
      NOW,
      new Set(['silver-1']),
    );
    expect(silverCase).toEqual([]);

    // A DIFFERENT GOLD in the same draft — not the one promoted to FINAL —
    // still releases normally. The pin is per-artifact, not per-draft.
    const unrelatedGoldStillReleases = selectCleanupEligibleArtifacts(
      [artifact({ id: 'gold-2', type: 'GOLD' })],
      new Set(),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) } }),
      CONFIG,
      NOW,
      new Set(['gold-1']), // gold-2 is not in this set
    );
    expect(unrelatedGoldStillReleases).toEqual(['gold-2']);
  });

  it("DS-LAKE-024-T05: never reclaims an edit draft's borrowed root BRONZE, which shares the adopted dataset's objectKey under a DIFFERENT id", () => {
    // resolveOrCreateEditDraftService mints a second DatasetArtifact row for
    // the edit draft (draft-2) — a fresh id ('borrowed-root'), never
    // reachable via ANY DatasetVersion's parentArtifactId chain, so
    // protectedArtifactIds correctly does NOT contain it. What it DOES share
    // with the live dataset's own adopted root ('bronze-1') is the exact
    // same objectKey — the same MinIO object, borrowed by pointer, not
    // copied. Without protectedObjectKeys, this row looks like an ordinary,
    // long-idle ACTIVE draft's BRONZE and reclaiming it would physically
    // delete the live dataset's own root bytes out from under 'bronze-1',
    // which itself remains correctly un-reclaimed in Postgres.
    const SHARED_KEY = 'dataset-1/artifacts/bronze-1/data.parquet';
    const result = selectCleanupEligibleArtifacts(
      [
        artifact({ id: 'bronze-1', type: 'BRONZE', objectKey: SHARED_KEY }),
        artifact({
          id: 'borrowed-root',
          type: 'BRONZE',
          draftId: 'draft-2',
          objectKey: SHARED_KEY,
        }),
      ],
      new Set(['bronze-1']), // only the ORIGINAL row is lineage-reachable
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        // Long-idle ACTIVE — would ordinarily clear activeIdleHours (6) and
        // release without the new pin.
        'draft-2': { status: 'ACTIVE', updatedAt: hoursAgo(500) },
      }),
      CONFIG,
      NOW,
      new Set(), // no FINAL-promotion sharing here — a different mechanism
      new Set([SHARED_KEY]), // protectedObjectKeys, as computeProtectedArtifactIds would build it
    );
    expect(result).toEqual([]);

    // Same setup, but the edit draft's row points at a DIFFERENT object —
    // proves the pin is keyed on the actual bytes, not on type/draft status
    // alone, so an edit draft's OWN genuinely-unshared intermediates still
    // release normally.
    const unrelatedStillReleases = selectCleanupEligibleArtifacts(
      [
        artifact({ id: 'bronze-1', type: 'BRONZE', objectKey: SHARED_KEY }),
        artifact({
          id: 'own-silver',
          type: 'SILVER',
          draftId: 'draft-2',
          objectKey: 'draft-2/artifacts/own-silver/data.parquet',
        }),
      ],
      new Set(['bronze-1']),
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        'draft-2': { status: 'ACTIVE', updatedAt: hoursAgo(500) },
      }),
      CONFIG,
      NOW,
      new Set(),
      new Set([SHARED_KEY]),
    );
    expect(unrelatedStillReleases).toEqual(['own-silver']);
  });
});

describe('reportCleanupEligibility (DS-LAKE-014-T05)', () => {
  it('attributes exactly one skip reason per non-eligible artifact, and the counts sum to the non-eligible total', () => {
    // 'too-fresh' needs its own draft (draft-2) with a recent updatedAt so it
    // lands in inside_window rather than sharing draft-1's already-elapsed one.
    const reportWithFreshDraft = reportCleanupEligibility(
      [
        artifact({ id: 'bronze-pinned', type: 'BRONZE' }),
        artifact({ id: 'gold-shared', type: 'GOLD' }),
        artifact({ id: 'ghost', draftId: 'no-such-draft' }),
        artifact({ id: 'no-draft-id', draftId: null }),
        artifact({ id: 'too-fresh', type: 'SILVER', draftId: 'draft-2' }),
        artifact({ id: 'releases', type: 'SILVER' }),
      ],
      new Set(['bronze-pinned']),
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        'draft-2': { status: 'SAVED', updatedAt: hoursAgo(1) },
      }),
      CONFIG,
      NOW,
      new Set(['gold-shared']),
    );

    expect(reportWithFreshDraft.eligible).toEqual(['releases']);
    expect(reportWithFreshDraft.skipped).toEqual({
      lineage_pinned: 1,
      shared_final_object: 1,
      shared_protected_object: 0,
      no_draft: 2,
      inside_window: 1,
    });

    // The invariant T05 exists to guarantee: every non-FINAL candidate is
    // either eligible or attributed to exactly one skip reason.
    const nonFinalCandidateCount = 6;
    const totalSkipped = Object.values(reportWithFreshDraft.skipped).reduce(
      (sum, n) => sum + n,
      0,
    );
    expect(reportWithFreshDraft.eligible.length + totalSkipped).toBe(
      nonFinalCandidateCount,
    );
  });

  it('never attributes a skip reason to a FINAL artifact', () => {
    const report = reportCleanupEligibility(
      [artifact({ id: 'final-1', type: 'FINAL' })],
      new Set(),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(10_000) } }),
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(Object.values(report.skipped).every((n) => n === 0)).toBe(true);
  });

  it('selectCleanupEligibleArtifacts and reportCleanupEligibility agree on the eligible set', () => {
    const args = [
      [
        artifact({ id: 'bronze-1', type: 'BRONZE' }),
        artifact({ id: 'silver-1', type: 'SILVER' }),
      ],
      new Set(['bronze-1']),
      drafts({ 'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) } }),
      CONFIG,
      NOW,
    ] as const;

    expect(selectCleanupEligibleArtifacts(...args)).toEqual(
      reportCleanupEligibility(...args).eligible,
    );
  });
});
