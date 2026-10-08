import {
  reportModelDraftEligibility,
  type ModelDraftCleanupCandidate,
  type ModelDraftCleanupRun,
} from './model-draft-cleanup-eligibility';

/**
 * MODEL-FLOW-011-T01. This is where all the risk in the sweep lives — a
 * wrong answer here means either a run's bytes are deleted while a
 * container may still be writing them, or an idle draft leaks forever.
 * Every acceptance criterion this predicate is responsible for (V01, V02,
 * T05's guard) is pinned directly here, without needing Postgres or MinIO.
 */

const NOW = new Date('2026-08-31T00:00:00.000Z');
const CONFIG = {
  emptyIdleHours: 24,
  runsIdleHours: 168,
  abandonedRecoveryHours: 168,
};

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}

function run(
  overrides: Partial<ModelDraftCleanupRun> & { id: string },
): ModelDraftCleanupRun {
  return { status: 'SUCCEEDED', modelId: null, ...overrides };
}

function draft(
  overrides: Partial<ModelDraftCleanupCandidate> & { id: string },
): ModelDraftCleanupCandidate {
  return {
    status: 'ACTIVE',
    updatedAt: NOW,
    objectsReclaimedAt: null,
    runs: [],
    candidateJobs: [],
    ...overrides,
  };
}

describe('reportModelDraftEligibility', () => {
  it('reclaims an ACTIVE draft owning zero runs past the empty-idle window', () => {
    const report = reportModelDraftEligibility(
      [draft({ id: 'd1', updatedAt: hoursAgo(25) })],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([
      {
        draftId: 'd1',
        tier: 'active_empty',
        reclaim: { subtree: true, runIds: [] },
      },
    ]);
  });

  it('does not reclaim an ACTIVE empty draft inside the empty-idle window', () => {
    const report = reportModelDraftEligibility(
      [draft({ id: 'd1', updatedAt: hoursAgo(23) })],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.inside_window).toBe(1);
  });

  it('does NOT reclaim a draft owning runs on the short empty-idle window', () => {
    // V02: the tier must bite BOTH ways — this draft is past the 24h empty
    // window but owns a run, so it must survive on the 168h runs window.
    const report = reportModelDraftEligibility(
      [draft({ id: 'd1', updatedAt: hoursAgo(48), runs: [run({ id: 'r1' })] })],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.inside_window).toBe(1);
  });

  it('reclaims a draft owning runs once the runs-idle window clears', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          updatedAt: hoursAgo(169),
          runs: [run({ id: 'r1' })],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([
      {
        draftId: 'd1',
        tier: 'active_runs',
        reclaim: { subtree: true, runIds: [] },
      },
    ]);
  });

  it('V02: one tick reclaims the empty draft and spares the draft owning runs', () => {
    const report = reportModelDraftEligibility(
      [
        draft({ id: 'empty', updatedAt: hoursAgo(48) }),
        draft({
          id: 'with-runs',
          updatedAt: hoursAgo(48),
          runs: [run({ id: 'r1' })],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible.map((e) => e.draftId)).toEqual(['empty']);
  });

  it('never reclaims TRAINED, on either window', () => {
    const report = reportModelDraftEligibility(
      [draft({ id: 'd1', status: 'TRAINED', updatedAt: hoursAgo(100_000) })],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.status_not_eligible).toBe(1);
  });

  it('never reclaims SAVED, on either window', () => {
    const report = reportModelDraftEligibility(
      [draft({ id: 'd1', status: 'SAVED', updatedAt: hoursAgo(100_000) })],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.status_not_eligible).toBe(1);
  });

  it('skips a QUEUED/RUNNING run regardless of age', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          updatedAt: hoursAgo(100_000),
          runs: [run({ id: 'r1', status: 'RUNNING' })],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.run_in_flight).toBe(1);
  });

  it('skips a draft with a QUEUED/RUNNING candidate job regardless of age', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          updatedAt: hoursAgo(100_000),
          candidateJobs: [{ status: 'QUEUED' }],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.candidate_job_in_flight).toBe(1);
  });

  it('applies the in-flight guard to an ABANDONED draft too, not only ACTIVE', () => {
    // abandonDraftService has no guard against abandoning a draft mid-run —
    // an ABANDONED row can reach here with a live run exactly like ACTIVE.
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          status: 'ABANDONED',
          updatedAt: hoursAgo(100_000),
          runs: [run({ id: 'r1', status: 'RUNNING' })],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.run_in_flight).toBe(1);
  });

  it('reclaims bytes for an ABANDONED draft past the recovery window', () => {
    const report = reportModelDraftEligibility(
      [draft({ id: 'd1', status: 'ABANDONED', updatedAt: hoursAgo(169) })],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([
      {
        draftId: 'd1',
        tier: 'abandoned_bytes',
        reclaim: { subtree: true, runIds: [] },
      },
    ]);
  });

  it('does not reclaim an ABANDONED draft already reclaimed', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          status: 'ABANDONED',
          updatedAt: hoursAgo(100_000),
          objectsReclaimedAt: hoursAgo(50_000),
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible).toEqual([]);
    expect(report.skipped.status_not_eligible).toBe(1);
  });

  it('MODEL-FLOW-011-T05: subtree delete only when no run is adopted', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          updatedAt: hoursAgo(169),
          runs: [run({ id: 'r1' }), run({ id: 'r2' })],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible[0].reclaim).toEqual({ subtree: true, runIds: [] });
  });

  it('T05: an adopted run is never named — only the unadopted siblings, one call each', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          updatedAt: hoursAgo(169),
          runs: [
            run({ id: 'unadopted-1' }),
            run({ id: 'adopted', modelId: 'model-1' }),
            run({ id: 'unadopted-2' }),
          ],
        }),
      ],
      CONFIG,
      NOW,
    );
    expect(report.eligible[0].reclaim).toEqual({
      subtree: false,
      runIds: ['unadopted-1', 'unadopted-2'],
    });
  });

  it('does not reclaim if EVERY run on the draft is adopted', () => {
    const report = reportModelDraftEligibility(
      [
        draft({
          id: 'd1',
          updatedAt: hoursAgo(169),
          runs: [run({ id: 'r1', modelId: 'model-1' })],
        }),
      ],
      CONFIG,
      NOW,
    );
    // Still eligible per the age tier (adoption doesn't gate eligibility
    // itself) — the reclaim shape is what changes: no subtree, no run ids.
    expect(report.eligible[0].reclaim).toEqual({ subtree: false, runIds: [] });
  });
});
