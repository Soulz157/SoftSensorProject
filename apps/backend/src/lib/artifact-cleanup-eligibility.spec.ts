import {
  selectCleanupEligibleArtifacts,
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
const CONFIG = { draftRecoveryHours: 168, intermediateRetentionHours: 168 };

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function artifact(
  overrides: Partial<CleanupCandidateArtifact> & { id: string },
): CleanupCandidateArtifact {
  return {
    type: 'BRONZE',
    draftId: 'draft-1',
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

  it('never touches an ACTIVE draft, however old the draft row is', () => {
    const result = selectCleanupEligibleArtifacts(
      [artifact({ id: 'bronze-1' })],
      new Set(),
      drafts({ 'draft-1': { status: 'ACTIVE', updatedAt: hoursAgo(100_000) } }),
      CONFIG,
      NOW,
    );
    expect(result).toEqual([]);
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

    const before = selectCleanupEligibleArtifacts(
      [...chain, abandonedSibling],
      reachable,
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        'draft-2': { status: 'ABANDONED', updatedAt: hoursAgo(500) },
      }),
      CONFIG,
      NOW,
    );
    // BRONZE survives (pinned); SILVER/GOLD/abandoned sibling reclaim; FINAL never touched.
    expect(before.sort()).toEqual(
      ['abandoned-bronze', 'gold-1', 'silver-1'].sort(),
    );

    // Now the version is ARCHIVED — nothing is reachable any more, so BRONZE releases too.
    const after = selectCleanupEligibleArtifacts(
      [...chain, abandonedSibling],
      new Set(),
      drafts({
        'draft-1': { status: 'SAVED', updatedAt: hoursAgo(500) },
        'draft-2': { status: 'ABANDONED', updatedAt: hoursAgo(500) },
      }),
      CONFIG,
      NOW,
    );
    expect(after.sort()).toEqual(
      ['abandoned-bronze', 'bronze-1', 'gold-1', 'silver-1'].sort(),
    );
  });
});
