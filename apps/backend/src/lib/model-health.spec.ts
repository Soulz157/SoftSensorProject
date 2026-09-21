import { classifyModelHealth, thresholdsFromSchedule } from './model-health';

/** A healthy, live schedule with nothing wrong — every test below names only
 *  the one field it is actually about. */
const healthy = {
  enabled: true,
  driftMonitor: true,
  driftStatus: null,
  consecutiveFailures: 0,
  staleness: 'OK',
  // Has produced before — so a STALE verdict means the record STOPPED, which
  // is the thing worth alarming about. The never-produced case has its own
  // test below.
  hasEverSucceeded: true,
  // T27/T28. Quiet on every new band by default, so each test below names
  // only the one signal it is actually about.
  consecutiveSkips: 0,
  skipStreakAlert: 3,
  missingPct: 0,
  missingPctWarn: 5,
  missingPctAlert: 20,
  frozenColumns: [] as string[],
  // There IS evidence to judge drift on unless a test says otherwise —
  // the no-evidence case is its own describe block below.
  driftEvidence: true,
  // MODEL-SERVE-012. UNKNOWN by default, NOT OK: these tests are about the
  // drift and liveness tiers, and a default of OK would let this axis answer
  // for them. UNKNOWN makes it silent, which is what "this test is not about
  // the output-error axis" means.
  residualSdStatus: 'UNKNOWN',
} as const;

describe('classifyModelHealth (MODEL-SERVE-001-T21)', () => {
  it('is OFF whenever driftMonitor is false, regardless of the underlying drift status', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        driftMonitor: false,
        driftStatus: 'OK',
      }),
    ).toEqual({ status: 'OFF', reason: null, frozenColumns: [] });
    expect(
      classifyModelHealth({
        ...healthy,
        driftMonitor: false,
        driftStatus: 'CRITICAL',
      }),
    ).toEqual({ status: 'OFF', reason: null, frozenColumns: [] });
    expect(classifyModelHealth({ ...healthy, driftMonitor: false })).toEqual({
      status: 'OFF',
      reason: null,
      frozenColumns: [],
    });
  });

  it('is UNKNOWN when monitoring is on but there is nothing to classify yet', () => {
    // No PRODUCTION version, or no windows with usable stats — the caller
    // never has to distinguish those reasons from each other here.
    expect(classifyModelHealth(healthy)).toEqual({
      status: 'UNKNOWN',
      reason: null,
      frozenColumns: [],
    });
  });

  it('passes the drift report status straight through once monitoring is on', () => {
    expect(classifyModelHealth({ ...healthy, driftStatus: 'OK' })).toEqual({
      status: 'OK',
      reason: null,
      frozenColumns: [],
    });
    expect(classifyModelHealth({ ...healthy, driftStatus: 'WARN' })).toEqual({
      status: 'WARN',
      reason: 'DRIFT_WARN',
      frozenColumns: [],
    });
    expect(
      classifyModelHealth({ ...healthy, driftStatus: 'CRITICAL' }),
    ).toEqual({
      // T27, DELIBERATE BEHAVIOUR CHANGE: a drift CRITICAL now surfaces as
      // ALERT carrying DRIFT_CRITICAL, because the card must name WHICH
      // metric fired — z-score is per-window while PSI is rolling-24, so one
      // merged "critical" would be one metric wearing another's name.
      // 'CRITICAL' remains in the union (stored payloads and the client map
      // still carry it) but is no longer produced.
      status: 'ALERT',
      reason: 'DRIFT_CRITICAL',
      frozenColumns: [],
    });
    expect(classifyModelHealth({ ...healthy, driftStatus: 'UNKNOWN' })).toEqual(
      { status: 'UNKNOWN', reason: null, frozenColumns: [] },
    );
  });
});

describe('classifyModelHealth — the liveness half (MODEL-SERVE-001-T26/V19)', () => {
  it('is ALERT/SOURCE_UNREACHABLE after three consecutive failed windows', () => {
    expect(classifyModelHealth({ ...healthy, consecutiveFailures: 3 })).toEqual(
      { status: 'ALERT', reason: 'SOURCE_UNREACHABLE', frozenColumns: [] },
    );
  });

  it('does not alarm below three consecutive failures', () => {
    // The same bar the deploy axis used before T26 moved this signal here —
    // not a new threshold, and deliberately not one of T28's configurable
    // ones.
    expect(classifyModelHealth({ ...healthy, consecutiveFailures: 2 })).toEqual(
      { status: 'UNKNOWN', reason: null, frozenColumns: [] },
    );
  });

  it('is ALERT/STALE when the record has stopped being written', () => {
    // THE WHOLE REASON T26 COULD NOT BE SPLIT. Before T26, staleness read as
    // deploy 'error' and that was the ONLY signal a dead scheduler produced.
    // If it were not re-homed here, both axes would read healthy while
    // nothing was running.
    expect(classifyModelHealth({ ...healthy, staleness: 'STALE' })).toEqual({
      status: 'ALERT',
      reason: 'STALE',
      frozenColumns: [],
    });
  });

  it('does NOT alarm STALE on a schedule that has never produced a window', () => {
    // FOUND BY A FAILING FIXTURE, NOT REASONED ABOUT IN ADVANCE: isStale(null,
    // ...) returns STALE by its own documented refusal-direction rule, so
    // without the hasEverSucceeded guard EVERY freshly enabled schedule would
    // alarm the instant it was created — it has produced nothing yet by
    // construction. STALE means the record STOPPED being written, which
    // presupposes it ever started. The deploy axis already says 'initializing'
    // here.
    expect(
      classifyModelHealth({
        ...healthy,
        staleness: 'STALE',
        hasEverSucceeded: false,
      }),
    ).toEqual({ status: 'UNKNOWN', reason: null, frozenColumns: [] });
  });

  it('reports a fault even when driftMonitor is off', () => {
    // driftMonitor defaults to FALSE. If liveness were gated behind it, every
    // schedule that never opted into drift watching would read OFF while its
    // source was down — the calm-dashboard blindness this task exists to
    // remove. driftMonitor governs DRIFT watching, not liveness.
    expect(
      classifyModelHealth({
        ...healthy,
        driftMonitor: false,
        consecutiveFailures: 3,
      }),
    ).toEqual({
      status: 'ALERT',
      reason: 'SOURCE_UNREACHABLE',
      frozenColumns: [],
    });
    expect(
      classifyModelHealth({
        ...healthy,
        driftMonitor: false,
        staleness: 'STALE',
      }),
    ).toEqual({ status: 'ALERT', reason: 'STALE', frozenColumns: [] });
  });

  it('a fault outranks a drift verdict, because drift over an unread source is meaningless', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        driftStatus: 'OK',
        consecutiveFailures: 3,
      }),
    ).toEqual({
      status: 'ALERT',
      reason: 'SOURCE_UNREACHABLE',
      frozenColumns: [],
    });
  });

  it('a DISABLED schedule is OFF, never ALERT — its windows are supposed to have stopped', () => {
    // "The operator turned it off" and "the record died" must not collapse
    // into one value: the one-control-two-facts defect T19 Part B closed.
    expect(
      classifyModelHealth({
        ...healthy,
        enabled: false,
        staleness: 'STALE',
        consecutiveFailures: 3,
      }),
    ).toEqual({ status: 'OFF', reason: null, frozenColumns: [] });
  });
});

/**
 * MODEL-SERVE-001-V20. PROVE STALENESS WAS NOT SILENCED BY THE MOVE.
 *
 * T26 took staleness off the deploy axis. Before that, `staleness -> deploy
 * 'error'` was the ONLY signal that the monitoring record had stopped being
 * written. A test that inspects only the deploy axis passes while staleness
 * has disappeared from the system entirely — which is T26's stated principal
 * risk, and the reason this verification exists at all.
 */
describe('staleness survives the axis move (MODEL-SERVE-001-V20)', () => {
  it('CHANGES the monitoring verdict, and names its reason', () => {
    const fresh = classifyModelHealth({ ...healthy, staleness: 'OK' });
    const stale = classifyModelHealth({ ...healthy, staleness: 'STALE' });

    // The axis MOVED, so assert it moved: not merely that the stale case
    // alarms, but that the two differ.
    expect(fresh).not.toEqual(stale);
    expect(stale).toEqual({
      status: 'ALERT',
      reason: 'STALE',
      frozenColumns: [],
    });
  });

  it('a SKIPPED window neither raises nor suppresses it', () => {
    // T01/T10/T11 each hold this: SKIPPED is a legitimate terminal status for
    // a quiet plant. A single SKIPPED must not alarm...
    expect(classifyModelHealth({ ...healthy, consecutiveSkips: 1 })).toEqual({
      status: 'UNKNOWN',
      reason: null,
      frozenColumns: [],
    });

    // ...and must not MASK a real staleness alarm either. Suppression is the
    // half a "does it alarm" test never catches.
    expect(
      classifyModelHealth({
        ...healthy,
        consecutiveSkips: 1,
        staleness: 'STALE',
      }),
    ).toEqual({ status: 'ALERT', reason: 'STALE', frozenColumns: [] });
  });

  it('a RUN of SKIPPED windows is its own alarm, with its own reason', () => {
    // A run is a different fact from a count: predictions have stopped
    // arriving, which is not the same as the connector being unreachable, and
    // sends a reader somewhere else.
    expect(classifyModelHealth({ ...healthy, consecutiveSkips: 3 })).toEqual({
      status: 'ALERT',
      reason: 'NO_PREDICTIONS',
      frozenColumns: [],
    });
  });

  it('honours skipStreakAlert rather than a hard-coded 3', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        consecutiveSkips: 3,
        skipStreakAlert: 5,
      }),
    ).toEqual({ status: 'UNKNOWN', reason: null, frozenColumns: [] });
    expect(
      classifyModelHealth({
        ...healthy,
        consecutiveSkips: 5,
        skipStreakAlert: 5,
      }),
    ).toEqual({
      status: 'ALERT',
      reason: 'NO_PREDICTIONS',
      frozenColumns: [],
    });
  });
});

describe('the remaining T27 bands', () => {
  it('grades Bad CELLS against the per-schedule missingPct bands', () => {
    expect(classifyModelHealth({ ...healthy, missingPct: 4 })).toEqual({
      status: 'UNKNOWN',
      reason: null,
      frozenColumns: [],
    });
    expect(classifyModelHealth({ ...healthy, missingPct: 5 })).toEqual({
      status: 'WARN',
      reason: 'BAD_DATA',
      frozenColumns: [],
    });
    expect(classifyModelHealth({ ...healthy, missingPct: 20 })).toEqual({
      status: 'ALERT',
      reason: 'BAD_DATA',
      frozenColumns: [],
    });
  });

  it('is FROZEN/SENSOR_FROZEN when an instrument has stopped moving', () => {
    expect(
      classifyModelHealth({ ...healthy, frozenColumns: ['AI001A2.PV'] }),
    ).toEqual({
      status: 'FROZEN',
      reason: 'SENSOR_FROZEN',
      frozenColumns: ['AI001A2.PV'],
    });
  });

  it('carries frozenColumns even when a higher-precedence fault outranks the band', () => {
    // T27: "a frozen tag makes its own drift figure a measurement of nothing,
    // so Alert leads while the per-tag badge stays." The stuck instrument
    // does not stop being stuck because the source also went down.
    expect(
      classifyModelHealth({
        ...healthy,
        frozenColumns: ['AI001A2.PV'],
        consecutiveFailures: 3,
      }),
    ).toEqual({
      status: 'ALERT',
      reason: 'SOURCE_UNREACHABLE',
      frozenColumns: ['AI001A2.PV'],
    });
  });

  it('ranks Sensor Frozen ABOVE Warning and BELOW Alert', () => {
    // Precedence, T27's own list: Offline > Alert > Sensor Frozen > Warning.
    expect(
      classifyModelHealth({
        ...healthy,
        frozenColumns: ['AI001A2.PV'],
        missingPct: 6, // would be WARN on its own
      }).status,
    ).toBe('FROZEN');
    expect(
      classifyModelHealth({
        ...healthy,
        frozenColumns: ['AI001A2.PV'],
        missingPct: 25, // ALERT outranks it
      }).status,
    ).toBe('ALERT');
  });
});

/**
 * T27 RULE (2), THE DARK-SHIP GATE. `resolveColumnBaseline` returns `{}` from
 * its SUCCESS path as well as its catch path, and T17 confirmed live that
 * today's feature specs carry no psiRefEdges at all — so "no evidence" is the
 * live case, not a hypothetical. An Alert path built on it reports healthy.
 */
describe('drift never speaks without evidence (MODEL-SERVE-001-T27 rule 2)', () => {
  it('is UNKNOWN, never OK, when there is no evidence to judge drift on', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        driftEvidence: false,
        // Even with a status that would otherwise read healthy.
        driftStatus: 'OK',
      }),
    ).toEqual({ status: 'UNKNOWN', reason: null, frozenColumns: [] });
  });

  it('does not raise a drift ALERT it has no evidence for either', () => {
    // The gate must fail toward "cannot say", not toward either verdict.
    expect(
      classifyModelHealth({
        ...healthy,
        driftEvidence: false,
        driftStatus: 'CRITICAL',
      }),
    ).toEqual({ status: 'UNKNOWN', reason: null, frozenColumns: [] });
  });

  it("passes computeDrift's OWN UNKNOWN through rather than folding it into OK", () => {
    // Every column lacked a usable baseline. That is not health.
    expect(classifyModelHealth({ ...healthy, driftStatus: 'UNKNOWN' })).toEqual(
      { status: 'UNKNOWN', reason: null, frozenColumns: [] },
    );
  });

  it('still reports LIVENESS faults when drift has no evidence', () => {
    // The gate silences the drift CLAIM, not the whole axis — otherwise a
    // model with a broken column_stats read would go quiet about its dead
    // source too.
    expect(
      classifyModelHealth({
        ...healthy,
        driftEvidence: false,
        consecutiveFailures: 3,
      }),
    ).toEqual({
      status: 'ALERT',
      reason: 'SOURCE_UNREACHABLE',
      frozenColumns: [],
    });
  });
});

describe('thresholdsFromSchedule (MODEL-SERVE-001-T21)', () => {
  it('renames driftThresholdPct to outOfRangePct, changing nothing else', () => {
    expect(
      thresholdsFromSchedule({
        warnSd: 1.5,
        criticalSd: 3.0,
        driftThresholdPct: 10,
      }),
    ).toEqual({
      warnSd: 1.5,
      criticalSd: 3.0,
      outOfRangePct: 10,
    });
  });

  it('carries a per-schedule override through untouched, not the system default', () => {
    expect(
      thresholdsFromSchedule({
        warnSd: 2.0,
        criticalSd: 4.0,
        driftThresholdPct: 25,
      }),
    ).toEqual({
      warnSd: 2.0,
      criticalSd: 4.0,
      outOfRangePct: 25,
    });
  });
});

describe('the output-error axis (MODEL-SERVE-012)', () => {
  it('reports RESIDUAL_SD_CRITICAL as an Alert', () => {
    expect(
      classifyModelHealth({ ...healthy, residualSdStatus: 'ALERT' }),
    ).toEqual({
      status: 'ALERT',
      reason: 'RESIDUAL_SD_CRITICAL',
      frozenColumns: [],
    });
  });

  it('reports RESIDUAL_SD_WARN as a Warning', () => {
    expect(
      classifyModelHealth({ ...healthy, residualSdStatus: 'WARN' }),
    ).toEqual({
      status: 'WARN',
      reason: 'RESIDUAL_SD_WARN',
      frozenColumns: [],
    });
  });

  it('lets DRIFT_CRITICAL lead when both fire — drifted inputs EXPLAIN a widened error', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        driftStatus: 'CRITICAL',
        residualSdStatus: 'ALERT',
      }),
    ).toEqual({
      status: 'ALERT',
      reason: 'DRIFT_CRITICAL',
      frozenColumns: [],
    });
  });

  it('lets DRIFT_WARN lead over RESIDUAL_SD_WARN, same ordering argument', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        driftStatus: 'WARN',
        residualSdStatus: 'WARN',
      }),
    ).toEqual({ status: 'WARN', reason: 'DRIFT_WARN', frozenColumns: [] });
  });

  it('keeps BAD_DATA above it — an error computed from bad readings measures nothing', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        missingPct: 30,
        residualSdStatus: 'ALERT',
      }),
    ).toEqual({ status: 'ALERT', reason: 'BAD_DATA', frozenColumns: [] });
  });

  it('keeps STALE above it, for the same reason', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        staleness: 'STALE',
        residualSdStatus: 'ALERT',
      }),
    ).toEqual({ status: 'ALERT', reason: 'STALE', frozenColumns: [] });
  });

  it('stays silent on UNKNOWN rather than reporting health it cannot measure', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        driftMonitor: false,
        residualSdStatus: 'UNKNOWN',
      }),
    ).toEqual({ status: 'OFF', reason: null, frozenColumns: [] });
  });

  it('REPORTS OK on a measured in-spec error even with drift watching off', () => {
    // The one case that must not fall through to OFF: OFF means "deliberately
    // not watching", which stops being true once joined pairs are graded.
    expect(
      classifyModelHealth({
        ...healthy,
        driftMonitor: false,
        residualSdStatus: 'OK',
      }),
    ).toEqual({ status: 'OK', reason: null, frozenColumns: [] });
  });

  it('is outranked by a disabled schedule, like every other signal', () => {
    expect(
      classifyModelHealth({
        ...healthy,
        enabled: false,
        residualSdStatus: 'ALERT',
      }),
    ).toEqual({ status: 'OFF', reason: null, frozenColumns: [] });
  });
});
